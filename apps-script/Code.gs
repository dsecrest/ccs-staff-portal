/**
 * Christian Center School — Staff Portal back end
 *
 * Runs inside the school's Google account. It receives submissions from the
 * portal website, saves uploaded files into Google Drive, logs every
 * submission in a Google Sheet, and emails a notification.
 *
 * SETUP (see README.md for screenshots-level detail):
 *   1. Edit the SETTINGS below.
 *   2. Choose the `setup` function in the toolbar and click Run (approve access).
 *   3. Deploy ▸ New deployment ▸ Web app — Execute as: Me, Who has access: Anyone.
 *   4. Copy the Web app URL into config.js on the website.
 */

// ----------------------------- SETTINGS -----------------------------
const SETTINGS = {
  // Who gets an email for each submission (comma-separate several).
  notifyEmail: 'CHANGE-ME@example.com',

  // Code you give new hires so they can upload documents and sign the
  // handbook. Change it whenever you like (e.g. each school year).
  newHireCode: 'WELCOME2026',

  schoolName: 'Christian Center School',
};
// --------------------------------------------------------------------

const PROPS = PropertiesService.getScriptProperties();

/** Run once from the editor. Creates the Drive folder + Sheet. */
function setup() {
  let root, ss;
  const rootId = PROPS.getProperty('ROOT_FOLDER_ID');
  if (rootId) {
    root = DriveApp.getFolderById(rootId);
    ss = SpreadsheetApp.openById(PROPS.getProperty('SHEET_ID'));
  } else {
    root = DriveApp.createFolder('CCS Staff Portal');
    ss = SpreadsheetApp.create('CCS Staff Portal — Submissions');
    DriveApp.getFileById(ss.getId()).moveTo(root);
    ss.getSheets()[0].setName('Applications');
    PROPS.setProperties({ ROOT_FOLDER_ID: root.getId(), SHEET_ID: ss.getId() });
  }
  ['Applicants', 'Staff'].forEach(name => child_(root, name));
  ['Applications', 'Recommendations', 'New Hire Documents', 'Handbook Signatures']
    .forEach(name => ss.getSheetByName(name) || ss.insertSheet(name));

  Logger.log('Drive folder: ' + root.getUrl());
  Logger.log('Spreadsheet:  ' + ss.getUrl());
  Logger.log('Next: Deploy ▸ New deployment ▸ Web app (Execute as Me, Anyone).');
}

/** Visiting the web-app URL in a browser just confirms it is running. */
function doGet() {
  return ContentService.createTextOutput('CCS Staff Portal is running.');
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const fields = req.fields || {};
    if (fields.website) return json_({ ok: true }); // spam-bot honeypot
    delete fields.website;

    const handler = HANDLERS[req.type];
    if (!handler) throw new Error('Unknown form.');
    if (!PROPS.getProperty('ROOT_FOLDER_ID')) throw new Error('Portal is not set up yet (run setup).');

    requireFields_(fields, ['First name', 'Last name', 'Email']);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.Email)) throw new Error('Please enter a valid email address.');

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      handler(req, fields);
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: true });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

const HANDLERS = {
  application(req, f) {
    if (!(req.files || []).some(x => x.field === 'Resume')) throw new Error('Please attach your resume.');
    const folder = personFolder_('Applicants', f);
    const links = saveFiles_(folder, req.files);

    // Printable PDF of the whole application, saved next to the resume.
    let pdf = null, pdfUrl = '';
    try {
      const html = applicationHtml_(req.layout, f, req.files, new Date());
      pdf = Utilities.newBlob(html, 'text/html', 'application.html').getAs('application/pdf')
        .setName(clean_(`Application - ${f['Last name']}, ${f['First name']} - ${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')}.pdf`));
      pdfUrl = folder.createFile(pdf).getUrl();
    } catch (err) {
      console.error('Application PDF failed', err);
    }

    appendRecord_('Applications', Object.assign(stamp_(), { 'Application PDF': pdfUrl }, f, links, { Folder: folder.getUrl() }));
    notify_(`New application: ${f['First name']} ${f['Last name']} — ${f.Position || ''}`,
      `${f['First name']} ${f['Last name']} (${f.Email}, ${f.Phone || 'no phone'}) applied for ${f.Position || 'a position'}.` +
      (pdf ? '\n\nThe full application is attached as a PDF.' : ''),
      folder, pdf ? [pdf] : []);
  },

  recommendation(req, f) {
    if (!(req.files || []).length) throw new Error('Please attach the letter.');
    const folder = child_(personFolder_('Applicants', f), 'Recommendation Letters');
    const prefix = (f['Recommender name'] || 'Letter').trim();
    const links = saveFiles_(folder, (req.files || []).map(x => Object.assign({}, x, { field: prefix })));
    appendRecord_('Recommendations', Object.assign(stamp_(), f, { Letters: Object.values(links).join('\n'), Folder: folder.getUrl() }));
    notify_(`Recommendation letter for ${f['First name']} ${f['Last name']}`,
      `${f['Recommender name']} uploaded a letter for ${f['First name']} ${f['Last name']} (${f.Email}).`,
      folder);
  },

  newhire(req, f) {
    checkCode_(f);
    if (!(req.files || []).length) throw new Error('Please attach at least one file.');
    const type = f['Document type'] || 'Other';
    const folder = child_(personFolder_('Staff', f), type);
    const files = req.files.map(x => Object.assign({}, x, { field: type }));
    const links = saveFiles_(folder, files);
    appendRecord_('New Hire Documents', Object.assign(stamp_(), f, { Files: Object.values(links).join('\n'), Folder: folder.getUrl() }));
    notify_(`New hire document: ${f['First name']} ${f['Last name']} — ${type}`,
      `${f['First name']} ${f['Last name']} uploaded ${req.files.length} file(s): ${type}.`,
      folder);
  },

  handbook(req, f) {
    checkCode_(f);
    if (f.Agreed !== 'Yes') throw new Error('Please check the box to agree.');
    if (!req.signature || !/^[A-Za-z0-9+/=]+$/.test(req.signature)) throw new Error('Please sign in the signature box.');
    const folder = personFolder_('Staff', f);
    const name = `${f['First name']} ${f['Last name']}`;
    const when = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMMM d, yyyy 'at' h:mm a z");
    const sig = Utilities.newBlob(Utilities.base64Decode(req.signature), 'image/png', `Signature - ${name}.png`);

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#181818;padding:24px;max-width:640px">
        <div style="color:#3b517c;font-style:italic">${esc_(SETTINGS.schoolName)}</div>
        <h1 style="color:#0d1d3f;margin:4px 0 18px;font-size:24px">Employee Handbook Acknowledgment</h1>
        <p style="font-size:14px;line-height:1.6">${esc_(req.statement || '')}</p>
        <table style="font-size:14px;margin-top:20px;border-collapse:collapse">
          <tr><td style="padding:4px 16px 4px 0;color:#5b6475">Employee</td><td><b>${esc_(name)}</b></td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#5b6475">Email</td><td>${esc_(f.Email)}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#5b6475">Handbook edition</td><td>${esc_(req.handbookVersion || '')}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#5b6475">Signed</td><td>${esc_(when)}</td></tr>
        </table>
        <p style="margin:24px 0 4px;color:#5b6475;font-size:12px">Signature</p>
        <img src="data:image/png;base64,${req.signature}" style="width:320px;border-bottom:1px solid #0d1d3f">
      </div>`;

    let docUrl;
    try {
      const pdf = Utilities.newBlob(html, 'text/html', 'ack.html').getAs('application/pdf')
        .setName(`Handbook Acknowledgment - ${name} - ${req.handbookVersion || ''}.pdf`);
      docUrl = folder.createFile(pdf).getUrl();
    } catch (err) {
      console.error('PDF conversion failed; saving PNG only', err);
    }
    const sigUrl = folder.createFile(sig).getUrl();

    appendRecord_('Handbook Signatures', Object.assign(stamp_(), f, {
      'Handbook edition': req.handbookVersion || '',
      'Signed PDF': docUrl || '',
      'Signature image': sigUrl,
      Folder: folder.getUrl(),
    }));
    notify_(`Handbook signed: ${name}`, `${name} (${f.Email}) signed the ${req.handbookVersion || ''} employee handbook.`, folder);
  },
};

// ---------------------------- printable PDF ----------------------------

/**
 * Builds print-ready HTML for an application. `layout` comes from the
 * website ([{title, names[]}] — one per form section) so the PDF follows
 * the form automatically when fields are added or renamed.
 */
function applicationHtml_(layout, f, files, when) {
  const skip = { 'Access code': 1, website: 1 };
  const attached = {};
  (files || []).forEach(x => (attached[x.field] = attached[x.field] || []).push(x.name));

  let sections = Array.isArray(layout) && layout.length ? layout : [{ title: 'Application', names: Object.keys(f) }];
  const listed = {};
  sections.forEach(s => (s.names || []).forEach(n => { listed[n] = 1; }));
  const extra = Object.keys(f).filter(n => !listed[n] && !skip[n]);
  if (extra.length) sections = sections.concat([{ title: 'Other', names: extra }]);

  const val = n => {
    if (attached[n]) return attached[n].map(esc_).join('<br>') + ' <span class="muted">(saved in folder)</span>';
    const v = f[n];
    if (v === undefined || String(v).trim() === '') return '<span class="muted">—</span>';
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (d) return esc_(Utilities.formatDate(new Date(+d[1], d[2] - 1, +d[3]), Session.getScriptTimeZone(), 'MMMM d, yyyy'));
    return esc_(v).replace(/\n/g, '<br>');
  };

  // "Reference 1 name / relationship / contact" → one compact table.
  const refTable = names => {
    const nums = [], cols = [];
    names.forEach(n => {
      const m = /^Reference (\d+) (.+)$/.exec(n);
      if (nums.indexOf(m[1]) === -1) nums.push(m[1]);
      if (cols.indexOf(m[2]) === -1) cols.push(m[2]);
    });
    const head = `<tr>${cols.map(c => `<td class="lbl">${esc_(c.charAt(0).toUpperCase() + c.slice(1))}</td>`).join('')}</tr>`;
    const rows = nums
      .filter(k => cols.some(c => String(f[`Reference ${k} ${c}`] || '').trim()))
      .map(k => `<tr>${cols.map(c => `<td>${val(`Reference ${k} ${c}`)}</td>`).join('')}</tr>`).join('');
    return head + rows;
  };
  const isLong = n => !attached[n] && String(f[n] || '').length > 70;

  const body = sections.map(s => {
    const names = (s.names || []).filter(n => !skip[n]);
    if (!names.length) return '';
    if (names.every(n => /^Reference \d+ .+$/.test(n))) {
      return `<div class="sec"><h2>${esc_(s.title)}</h2><table class="grid">${refTable(names)}</table></div>`;
    }
    const rows = names.map(n => isLong(n)
      ? `<tr><td colspan="2" class="lbl">${esc_(n)}</td></tr><tr><td colspan="2" class="long">${val(n)}</td></tr>`
      : `<tr><td class="lbl">${esc_(n)}</td><td>${val(n)}</td></tr>`).join('');
    return `<div class="sec"><h2>${esc_(s.title)}</h2><table>${rows}</table></div>`;
  }).join('');

  const tz = Session.getScriptTimeZone();
  const name = `${f['First name'] || ''} ${f['Last name'] || ''}`.trim();
  return `<html><head><style>
    body { font-family: Arial, Helvetica, sans-serif; color: #181818; font-size: 11pt; margin: 0; }
    .head { border-bottom: 3px solid #0d1d3f; padding-bottom: 10px; margin-bottom: 6px; }
    .school { color: #3b517c; font-style: italic; font-family: Georgia, serif; font-size: 11pt; }
    h1 { color: #0d1d3f; font-size: 20pt; margin: 2px 0 0; }
    .sub { color: #3b517c; font-size: 10pt; margin-top: 4px; }
    .who { font-size: 15pt; font-weight: bold; color: #0d1d3f; margin-top: 10px; }
    .sec { page-break-inside: avoid; margin-top: 14px; }
    h2 { font-size: 9pt; letter-spacing: 1px; text-transform: uppercase; color: #0d1d3f;
         background: #d9e3f1; padding: 5px 8px; margin: 0; border-top: 1px solid #4684c9; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 5px 8px; vertical-align: top; border-bottom: 1px solid #e3e8f0; }
    td.lbl { width: 34%; color: #5b6475; font-size: 9.5pt; }
    table.grid td.lbl { width: auto; }
    tr td[colspan] { border-bottom: 0; }
    td.long { border-bottom: 1px solid #e3e8f0; padding-bottom: 8px; line-height: 1.45; }
    .muted { color: #9aa3b2; }
    .foot { margin-top: 18px; font-size: 8.5pt; color: #9aa3b2; border-top: 1px solid #e3e8f0; padding-top: 6px; }
  </style></head><body>
    <div class="head">
      <div class="school">${esc_(SETTINGS.schoolName)}</div>
      <h1>Employment Application</h1>
      <div class="who">${esc_(name)}</div>
      <div class="sub">${esc_(f.Position || '')}${f.Position ? ' · ' : ''}Submitted ${esc_(Utilities.formatDate(when, tz, "MMMM d, yyyy 'at' h:mm a"))}</div>
    </div>
    ${body}
    <div class="foot">Submitted online through the ${esc_(SETTINGS.schoolName)} Staff Portal.</div>
  </body></html>`;
}

// ------------------------------ helpers ------------------------------

function checkCode_(f) {
  const given = String(f['Access code'] || '').trim().toUpperCase();
  delete f['Access code']; // never store it
  if (given !== String(SETTINGS.newHireCode).trim().toUpperCase()) {
    Utilities.sleep(1500); // slow down guessing
    throw new Error('That access code is not correct. Please check with the school office.');
  }
}

function requireFields_(f, names) {
  names.forEach(n => { if (!String(f[n] || '').trim()) throw new Error(`Please fill in "${n}".`); });
}

/** Applicants/Last, First (email)  — same folder reused for later uploads. */
function personFolder_(group, f) {
  const root = DriveApp.getFolderById(PROPS.getProperty('ROOT_FOLDER_ID'));
  const name = clean_(`${f['Last name']}, ${f['First name']} (${String(f.Email).toLowerCase()})`);
  return child_(child_(root, group), name);
}

function child_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** Saves files; returns { "<field>": "link\nlink" } for the sheet. */
function saveFiles_(folder, files) {
  const out = {};
  (files || []).forEach(x => {
    const blob = Utilities.newBlob(Utilities.base64Decode(x.data), x.mimeType || 'application/octet-stream',
      clean_(`${x.field} - ${x.name}`));
    const url = folder.createFile(blob).getUrl();
    out[x.field] = out[x.field] ? out[x.field] + '\n' + url : url;
  });
  return out;
}

/** Appends a row, adding any new column headers automatically. */
function appendRecord_(sheetName, record) {
  const ss = SpreadsheetApp.openById(PROPS.getProperty('SHEET_ID'));
  const sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  const headers = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  let changed = false;
  Object.keys(record).forEach(k => { if (headers.indexOf(k) === -1) { headers.push(k); changed = true; } });
  if (changed) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#d9e3f1');
    sh.setFrozenRows(1);
  }
  sh.appendRow(headers.map(h => safeCell_(record[h])));
}

function stamp_() {
  return { Submitted: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') };
}

function notify_(subject, body, folder, attachments) {
  if (!SETTINGS.notifyEmail || /CHANGE-ME/.test(SETTINGS.notifyEmail)) return;
  try {
    const sheetUrl = SpreadsheetApp.openById(PROPS.getProperty('SHEET_ID')).getUrl();
    MailApp.sendEmail(SETTINGS.notifyEmail, `[Staff Portal] ${subject}`,
      `${body}\n\nFiles: ${folder.getUrl()}\nAll submissions: ${sheetUrl}`,
      { attachments: attachments || [] });
  } catch (err) {
    console.error('Email failed', err);
  }
}

// Stop spreadsheet formula injection (values starting with = + - @).
function safeCell_(v) {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function clean_(s) { return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180); }
function esc_(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

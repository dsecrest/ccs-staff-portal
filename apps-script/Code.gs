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
    appendRecord_('Applications', Object.assign(stamp_(), f, links, { Folder: folder.getUrl() }));
    notify_(`New application: ${f['First name']} ${f['Last name']} — ${f.Position || ''}`,
      `${f['First name']} ${f['Last name']} (${f.Email}, ${f.Phone || 'no phone'}) applied for ${f.Position || 'a position'}.`,
      folder);
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

function notify_(subject, body, folder) {
  if (!SETTINGS.notifyEmail || /CHANGE-ME/.test(SETTINGS.notifyEmail)) return;
  try {
    const sheetUrl = SpreadsheetApp.openById(PROPS.getProperty('SHEET_ID')).getUrl();
    MailApp.sendEmail(SETTINGS.notifyEmail, `[Staff Portal] ${subject}`,
      `${body}\n\nFiles: ${folder.getUrl()}\nAll submissions: ${sheetUrl}`);
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

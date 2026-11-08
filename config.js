// ---------------------------------------------------------------
// Staff Portal settings — edit these values, nothing else needed.
// ---------------------------------------------------------------
window.PORTAL_CONFIG = {
  schoolName: "Christian Center School",

  // Paste the Google Apps Script "Web app" URL here after deploying
  // apps-script/Code.gs (see README.md, step 1). Looks like:
  // https://script.google.com/macros/s/AKfy..../exec
  scriptUrl: "",

  // Where the employee handbook PDF lives. Easiest: upload the PDF to
  // Google Drive, set sharing to "Anyone with the link can view", and paste
  // https://drive.google.com/file/d/FILE_ID/preview
  // (or drop a PDF in this folder and use "handbook/employee-handbook.pdf").
  handbookUrl: "",

  // Shown on the signature record so you know which edition they signed.
  handbookVersion: "2026–2027",

  // Upload limits (Google Apps Script caps a single submission at ~50 MB).
  maxFileMB: 10,
  maxTotalMB: 30,
};

"use strict";

const dataUrl = "data/directory.json";
const fields = ["FirstName", "LastName", "Title", "Manager", "Cell", "Fax", "Email", "Department", "Location", "URL", "Description"];
const status = document.getElementById("status");
const form = document.getElementById("person-form");
const editor = document.getElementById("editor");
const photo = document.getElementById("photo");
const photoPreview = document.getElementById("photo-preview");
const saveButton = document.getElementById("save");
const settingsForm = document.getElementById("settings-form");
const logoFile = document.getElementById("logo-file");
const logoPreview = document.getElementById("logo-preview");
const invertedLogoPreview = document.getElementById("logo-preview-inverted");
const invertLogo = document.getElementById("invert-logo");
const importSection = document.getElementById("import-section");
const csvFile = document.getElementById("csv-file");
const csvMapping = document.getElementById("csv-mapping");
const csvMappingFields = document.getElementById("csv-mapping-fields");
const importSubmit = document.getElementById("import-submit");
const csvStatus = document.getElementById("csv-status");
const csvFields = [...fields, "Enabled"];
const requiredCsvFields = ["FirstName", "LastName", "Department"];
const csvLabels = { FirstName: "First name", LastName: "Last name", URL: "Website", Enabled: "Show in directory" };
let csvRows = null;
let csvVersion = 0;
document.getElementById("logout").addEventListener("click", () => {
  if (confirm("Return to the directory? Your browser may retain the admin credentials. Close all browser windows to ensure you are signed out.")) {
    window.location.href = "../";
  }
});
let data;
let original;
let editing = null;
let picture = "";
let photoVersion = 0;
let busy = false;
let logo;
let logoVersion = 0;

function message(text) {
  status.textContent = text;
}

async function readData() {
  const response = await fetch(dataUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not read the data file (HTTP ${response.status}).`);
  const text = await response.text();
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.people)) throw new Error("The data file does not contain a people list.");
  return { text, parsed };
}

function setBusy(value) {
  busy = value;
  document.getElementById("add").disabled = value || !data;
  document.getElementById("open-import").disabled = value || !data;
  csvFile.disabled = value || !data;
  importSubmit.disabled = value || !data || !csvRows;
  document.getElementById("cancel-import").disabled = value;
  csvMappingFields.querySelectorAll("select").forEach(select => { select.disabled = value; });
  saveButton.disabled = value;
  document.getElementById("save-settings").disabled = value || !data;
  logoFile.disabled = value || !data;
  invertLogo.disabled = value || !data;
  document.getElementById("remove-logo").disabled = value || !data;
  document.getElementById("default-logo").disabled = value || !data;
  document.querySelectorAll("#people button").forEach(button => { button.disabled = value; });
}

function showLogo() {
  const source = logo === undefined ? "../images/logo.png" : logo;
  [logoPreview, invertedLogoPreview].forEach(preview => {
    preview.hidden = !source;
    if (source) preview.src = source;
    else preview.removeAttribute("src");
  });
}

settingsForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !data) return;
  const title = document.getElementById("page-title").value.trim();
  if (!title) {
    message("Enter a browser tab title.");
    return;
  }
  const settings = { ...data.settings, title, invertLogo: invertLogo.checked };
  if (logo === undefined) delete settings.logo;
  else settings.logo = logo;
  await saveData({ ...data, settings }, false);
});

logoFile.addEventListener("change", async () => {
  const version = ++logoVersion;
  const file = logoFile.files[0];
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 1024 * 1024) {
    message("Choose a JPEG, PNG or WebP logo no larger than 1 MB.");
    logoFile.value = "";
    return;
  }
  setBusy(true);
  try {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const encoded = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read the logo file."));
        reader.readAsDataURL(file);
      });
      if (version === logoVersion) {
        logo = encoded;
        showLogo();
        message("Logo ready. Save page settings to apply it.");
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    if (version === logoVersion) message(`Could not process logo: ${error.message}`);
  } finally {
    setBusy(false);
  }
});

document.getElementById("remove-logo").addEventListener("click", () => {
  logoVersion++;
  logo = "";
  logoFile.value = "";
  showLogo();
});
document.getElementById("default-logo").addEventListener("click", () => {
  logoVersion++;
  logo = undefined;
  logoFile.value = "";
  showLogo();
});

function render() {
  const body = document.getElementById("people");
  body.replaceChildren();
  data.people.forEach((person, index) => {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = `${person.FirstName || ""} ${person.LastName || ""}`.trim();
    const department = document.createElement("td");
    department.textContent = person.Department || "";
    const actions = document.createElement("td");
    const edit = document.createElement("button");
    edit.textContent = "Edit";
    edit.type = "button";
    edit.addEventListener("click", () => openEditor(index));
    const remove = document.createElement("button");
    remove.textContent = "Delete";
    remove.type = "button";
    remove.addEventListener("click", () => deletePerson(index));
    actions.append(edit, remove);
    row.append(name, department, actions);
    body.append(row);
  });
  setBusy(false);
}

function showPhoto() {
  photoPreview.hidden = !picture;
  if (picture) photoPreview.src = picture;
  else photoPreview.removeAttribute("src");
}

function openEditor(index) {
  if (busy) return;
  photoVersion++;
  editing = index;
  const person = index === null ? {} : data.people[index];
  form.reset();
  fields.forEach(field => { form.elements.namedItem(field).value = person[field] || ""; });
  form.elements.namedItem("Enabled").checked = person.Enabled !== false;
  picture = person.Picture || "";
  showPhoto();
  document.getElementById("editor-title").textContent = index === null ? "Add person" : "Edit person";
  editor.hidden = false;
  message("");
  form.elements.namedItem("FirstName").focus();
}

function closeEditor() {
  photoVersion++;
  editor.hidden = true;
  form.reset();
  picture = "";
  showPhoto();
}

async function saveData(next, closePersonEditor = true, successMessage = "Changes saved.") {
  setBusy(true);
  let token = "";
  let saved = false;
  let failure = "";
  try {
    const lockResponse = await fetch(dataUrl, {
      method: "LOCK",
      headers: { "Content-Type": "application/xml; charset=utf-8", "Timeout": "Second-60", "Depth": "0" },
      body: '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>People Directory administrator</D:owner></D:lockinfo>'
    });
    if (!lockResponse.ok) throw new Error(`Could not lock the data file (HTTP ${lockResponse.status}). Another administrator may be editing it.`);
    token = lockResponse.headers.get("Lock-Token");
    if (!token) throw new Error("The server did not return a WebDAV lock token. Check Apache WebDAV configuration.");
    const current = await readData();
    if (current.text !== original) throw new Error("The directory was changed by another administrator. Reload this page and make your changes again.");
    const text = JSON.stringify(next, null, 2) + "\n";
    const response = await fetch(dataUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json; charset=utf-8", "If": `(${token})` },
      body: text
    });
    if (!response.ok) throw new Error(`Could not save the data file (HTTP ${response.status}). Check Apache permissions and WebDAV configuration.`);
    data = next;
    original = text;
    saved = true;
  } catch (error) {
    failure = error.message;
  } finally {
    if (token) {
      try {
        const response = await fetch(dataUrl, { method: "UNLOCK", headers: { "Lock-Token": token } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        failure += `${failure ? " " : ""}Could not release the WebDAV lock (${error.message}); it should expire automatically.`;
      }
    }
    setBusy(false);
  }
  if (saved) {
    if (closePersonEditor) closeEditor();
    render();
  }
  message(failure || successMessage);
  return saved;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  const finishRow = () => {
    row.push(field);
    if (row.some(value => value.trim())) rows.push(row);
    row = [];
    field = "";
    afterQuote = false;
  };
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else {
        field += char;
      }
    } else if (char === "," || char === "\r" || char === "\n") {
      if (char === ",") { row.push(field); field = ""; afterQuote = false; }
      else {
        finishRow();
        if (char === "\r" && text[i + 1] === "\n") i++;
      }
    } else if (char === '"' && !field && !afterQuote) {
      quoted = true;
    } else if (char === '"' || afterQuote) {
      throw new Error("Invalid quoting in CSV file.");
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("CSV file has an unclosed quoted field.");
  if (row.length || field || afterQuote) finishRow();
  if (rows.length < 2) throw new Error("CSV must contain a header and at least one data row.");
  const headers = rows.shift().map(header => header.trim());
  if (headers.some(header => !header)) throw new Error("CSV column names cannot be empty.");
  if (new Set(headers.map(header => header.toLowerCase())).size !== headers.length) {
    throw new Error("CSV column names must be unique.");
  }
  rows.forEach((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV record ${index + 2} has ${values.length} columns; expected ${headers.length}.`);
  });
  return { headers, rows };
}

function createCsvMapping(headers) {
  csvMappingFields.replaceChildren();
  csvFields.forEach(field => {
    const label = document.createElement("label");
    label.textContent = `${csvLabels[field] || field}${requiredCsvFields.includes(field) ? " (required)" : ""}`;
    const select = document.createElement("select");
    select.name = field;
    select.append(new Option("Not mapped", ""));
    headers.forEach((header, index) => select.append(new Option(header, String(index))));
    const normalized = value => value.toLowerCase().replace(/[\s_-]/g, "");
    const aliases = [field, csvLabels[field] || field].map(normalized);
    const index = headers.findIndex(header => aliases.includes(normalized(header)));
    if (index >= 0) select.value = String(index);
    label.append(select);
    csvMappingFields.append(label);
  });
}

function openImport() {
  if (busy) return;
  importSection.hidden = false;
  csvStatus.textContent = "";
  csvFile.focus();
}
document.getElementById("open-import").addEventListener("click", openImport);
document.getElementById("cancel-import").addEventListener("click", () => {
  csvVersion++;
  csvRows = null;
  csvFile.value = "";
  csvMapping.hidden = true;
  csvMappingFields.replaceChildren();
  importSection.hidden = true;
  setBusy(false);
});
csvFile.addEventListener("change", async () => {
  const version = ++csvVersion;
  csvRows = null;
  csvMapping.hidden = true;
  csvMappingFields.replaceChildren();
  const file = csvFile.files[0];
  if (!file) { setBusy(false); return; }
  if (file.size > 5 * 1024 * 1024) {
    csvStatus.textContent = "CSV file must be no larger than 5 MB.";
    setBusy(false);
    return;
  }
  setBusy(true);
  try {
    const bytes = await file.arrayBuffer();
    const parsed = parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (version !== csvVersion) return;
    csvRows = parsed.rows;
    createCsvMapping(parsed.headers);
    document.getElementById("csv-count").textContent = `${csvRows.length} data record(s) ready to map.`;
    csvMapping.hidden = false;
    csvStatus.textContent = "CSV loaded. Review the column mappings before importing.";
  } catch (error) {
    if (version === csvVersion) csvStatus.textContent = `Could not read CSV: ${error.message}`;
  } finally {
    if (version === csvVersion) setBusy(false);
  }
});

document.getElementById("import-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !data || !csvRows) return;
  try {
    const mapping = Object.fromEntries([...csvMappingFields.querySelectorAll("select")].map(select => [select.name, select.value]));
    for (const field of requiredCsvFields) {
      if (mapping[field] === "") throw new Error(`Map the ${csvLabels[field] || field} column.`);
    }
    const selected = Object.values(mapping).filter(value => value !== "");
    if (new Set(selected).size !== selected.length) throw new Error("Each CSV column can only be mapped to one field.");
    const key = person => [person.FirstName, person.LastName, person.Department].map(value => String(value || "").trim().toLowerCase()).join("\u0000");
    const seen = new Set(data.people.map(key));
    const added = [];
    let skipped = 0;
    csvRows.forEach((row, index) => {
      const person = {};
      fields.forEach(field => { person[field] = mapping[field] === "" ? "" : row[Number(mapping[field])].trim(); });
      for (const field of requiredCsvFields) {
        if (!person[field]) throw new Error(`CSV record ${index + 2}: ${csvLabels[field] || field} is required.`);
      }
      for (const field of fields) {
        const max = field === "Description" ? 2000 : field === "URL" ? 1000 : 200;
        if (person[field].length > max) throw new Error(`CSV record ${index + 2}: ${csvLabels[field] || field} exceeds ${max} characters.`);
      }
      if (person.URL) {
        let url;
        try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(person.URL) ? person.URL : `http://${person.URL}`); }
        catch { throw new Error(`CSV record ${index + 2}: invalid website address.`); }
        if (!["http:", "https:"].includes(url.protocol)) throw new Error(`CSV record ${index + 2}: website must use HTTP or HTTPS.`);
      }
      const emailInput = form.elements.namedItem("Email");
      const previousEmail = emailInput.value;
      emailInput.value = person.Email;
      const validEmail = emailInput.validity.valid;
      emailInput.value = previousEmail;
      if (!validEmail) throw new Error(`CSV record ${index + 2}: invalid email address.`);
      const enabled = mapping.Enabled === "" ? "" : row[Number(mapping.Enabled)].trim().toLowerCase();
      if (!["", "true", "false", "yes", "no", "1", "0"].includes(enabled)) throw new Error(`CSV record ${index + 2}: Enabled must be true or false.`);
      person.Enabled = !["false", "no", "0"].includes(enabled);
      person.Picture = "";
      const id = key(person);
      if (seen.has(id)) { skipped++; return; }
      seen.add(id);
      added.push(person);
    });
    if (!added.length) {
      csvStatus.textContent = `No people imported. ${skipped} matching record(s) skipped.`;
      return;
    }
    const saved = await saveData({ ...data, people: [...data.people, ...added] }, false,
      `Imported ${added.length} person(s); skipped ${skipped} matching record(s).`);
    if (saved) {
      csvRows = null;
      csvFile.value = "";
      csvMapping.hidden = true;
      csvMappingFields.replaceChildren();
      importSection.hidden = true;
      setBusy(false);
    } else {
      csvStatus.textContent = status.textContent;
    }
  } catch (error) {
    csvStatus.textContent = `Import not saved: ${error.message}`;
  }
});

async function deletePerson(index) {
  if (busy) return;
  const person = data.people[index];
  if (!confirm(`Delete ${person.FirstName} ${person.LastName}?`)) return;
  const next = { ...data, people: data.people.filter((_, i) => i !== index) };
  await saveData(next);
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  const person = editing === null ? {} : { ...data.people[editing] };
  fields.forEach(field => { person[field] = form.elements.namedItem(field).value.trim(); });
  person.Enabled = form.elements.namedItem("Enabled").checked;
  if (!person.FirstName || !person.LastName) {
    message("First and last names are required.");
    return;
  }
  if (person.URL) {
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(person.URL) ? person.URL : `http://${person.URL}`);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported protocol");
    } catch {
      message("Enter a valid HTTP or HTTPS website address.");
      return;
    }
  }
  person.Picture = picture;
  const people = data.people.slice();
  if (editing === null) people.push(person);
  else people[editing] = person;
  await saveData({ ...data, people });
});

photo.addEventListener("change", async () => {
  const version = ++photoVersion;
  const file = photo.files[0];
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    message("Choose a JPEG, PNG or WebP image no larger than 10 MB.");
    photo.value = "";
    return;
  }
  setBusy(true);
  try {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1, 320 / image.naturalWidth, 320 / image.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      if (version === photoVersion) {
        picture = canvas.toDataURL("image/jpeg", 0.85);
        showPhoto();
        message("Photo ready. Save the person to apply it.");
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    if (version === photoVersion) message(`Could not process image: ${error.message}`);
  } finally {
    setBusy(false);
  }
});

document.getElementById("add").addEventListener("click", () => openEditor(null));
document.getElementById("cancel").addEventListener("click", closeEditor);
document.getElementById("remove-photo").addEventListener("click", () => {
  photoVersion++;
  picture = "";
  photo.value = "";
  showPhoto();
});

readData().then(result => {
  data = result.parsed;
  original = result.text;
  document.getElementById("page-title").value = data.settings?.title || directoryConfig.title;
  invertLogo.checked = data.settings?.invertLogo !== false;
  logo = data.settings?.logo;
  showLogo();
  render();
}).catch(error => {
  message(`Admin unavailable: ${error.message}`);
});

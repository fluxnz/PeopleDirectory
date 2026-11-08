"use strict";

const fieldLabels = {
  Picture: "", FirstName: "First Name", LastName: "Last Name",
  FNLink: "First Name", FNLinkPic: "First Name",
  LNLink: "Last Name", LNLinkPic: "Last Name",
  Title: "Title", Manager: "Manager", Cell: "Cell", Fax: "Fax",
  Email: "Email", Department: "Department", Location: "Location",
  Link: "Link", Description: "Description"
};

const imageUrls = new Map();
const photoPreview = document.createElement("div");
photoPreview.className = "photo-popup";
photoPreview.hidden = true;
photoPreview.setAttribute("aria-hidden", "true");
const previewImage = document.createElement("img");
previewImage.alt = "";
photoPreview.append(previewImage);
document.body.append(photoPreview);
let previewAnchor = null;

function positionPhotoPreview() {
  if (!previewAnchor || photoPreview.hidden) return;
  const anchor = previewAnchor.getBoundingClientRect();
  const preview = photoPreview.getBoundingClientRect();
  const gap = 8;
  const left = Math.max(gap, Math.min(anchor.left, window.innerWidth - preview.width - gap));
  const below = anchor.bottom + gap;
  const top = below + preview.height <= window.innerHeight - gap
    ? below : Math.max(gap, anchor.top - preview.height - gap);
  photoPreview.style.left = `${left}px`;
  photoPreview.style.top = `${top}px`;
}

function showPhotoPreview(anchor, url) {
  previewAnchor = anchor;
  previewImage.src = url;
  photoPreview.hidden = false;
  positionPhotoPreview();
}

function hidePhotoPreview(anchor) {
  if (previewAnchor === anchor && !anchor.matches(":hover") && !anchor.matches(":focus")) {
    photoPreview.hidden = true;
    previewAnchor = null;
  }
}

previewImage.addEventListener("load", positionPhotoPreview);
window.addEventListener("resize", positionPhotoPreview);
window.addEventListener("scroll", positionPhotoPreview, true);

function imageUrl(value) {
  if (!value || !/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value)) return null;
  if (!imageUrls.has(value)) {
    const [header, encoded] = value.split(",");
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    imageUrls.set(value, URL.createObjectURL(new Blob([bytes], { type: header.slice(5, header.indexOf(";")) })));
  }
  return imageUrls.get(value);
}

function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `http://${value}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function fieldValue(person, field) {
  if (field.startsWith("FNLink")) return person.FirstName || "";
  if (field.startsWith("LNLink")) return person.LastName || "";
  if (field === "Link") return person.URL ? "Home Page" : "";
  return person[field] || "";
}

function makeCell(person, field) {
  const cell = document.createElement("td");
  const value = fieldValue(person, field);
  const pictureUrl = ["Picture", "FNLinkPic", "LNLinkPic"].includes(field) ? imageUrl(person.Picture) : null;
  if (field === "Picture" && pictureUrl) {
    const picture = document.createElement("span");
    picture.className = "picture";
    picture.tabIndex = 0;
    picture.setAttribute("aria-label", `Photo of ${person.FirstName} ${person.LastName}`);
    const thumb = document.createElement("img");
    thumb.className = "thumbnail";
    thumb.src = pictureUrl;
    thumb.alt = "";
    picture.addEventListener("mouseenter", () => showPhotoPreview(picture, pictureUrl));
    picture.addEventListener("focus", () => showPhotoPreview(picture, pictureUrl));
    picture.addEventListener("mouseleave", () => hidePhotoPreview(picture));
    picture.addEventListener("blur", () => hidePhotoPreview(picture));
    picture.append(thumb);
    cell.append(picture);
  } else {
    let href = null;
    if (field === "Email" && value) href = `mailto:${encodeURIComponent(value).replace(/%40/g, "@")}`;
    if (field === "Link" || field === "FNLink" || field === "LNLink") href = safeUrl(person.URL);
    if (field === "FNLinkPic" || field === "LNLinkPic") href = pictureUrl;
    if (href) {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = value;
      if (field !== "Email") {
        link.target = "_blank";
        link.rel = "noopener";
      }
      cell.append(link);
    } else {
      cell.textContent = value;
    }
  }
  return cell;
}

async function showDirectory() {
  const status = document.getElementById("status");
  try {
    if (!directoryConfig.fields.every(field => Object.hasOwn(fieldLabels, field)) ||
        !["Department", "Location", "Manager"].includes(directoryConfig.buttonBy)) {
      throw new Error("Invalid directory configuration.");
    }
    const response = await fetch("data/directory.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load directory (HTTP ${response.status}).`);
    const data = await response.json();
    if (!Array.isArray(data.people)) throw new Error("The data file does not contain a people list.");
    data.people = data.people
      .filter(person => person.Enabled !== false && (person.Location || "").trim().toLowerCase() !== "exclude")
      .map(person => ({ ...person, Location: (person.Location || "").trim() || directoryConfig.locationDefault || "" }));
    const title = typeof data.settings?.title === "string" && data.settings.title.trim()
      ? data.settings.title : directoryConfig.title;
    document.title = title;
    const logo = document.querySelector(".logo");
    logo.classList.toggle("invert-dark", data.settings?.invertLogo !== false);
    if (typeof data.settings?.logo === "string") {
      const url = imageUrl(data.settings.logo);
      if (url) {
        logo.hidden = false;
        logo.src = url;
      } else {
        logo.hidden = true;
      }
    }
    const table = document.getElementById("TableMain");
    const header = document.createElement("tr");
    let sortField = directoryConfig.sortBy;
    let ascending = true;
    let selected = "";
    const search = document.getElementById("search");
    const render = () => {
      photoPreview.hidden = true;
      previewAnchor = null;
      const words = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const people = data.people.filter(person => {
        const name = `${person.FirstName || ""} ${person.LastName || ""}`.toLowerCase();
        return (!words.length || words.some(word => name.includes(word))) &&
          (!selected || person[directoryConfig.buttonBy] === selected);
      });
      people.sort((a, b) => fieldValue(a, sortField).localeCompare(fieldValue(b, sortField), undefined, { sensitivity: "base" }) * (ascending ? 1 : -1));
      const rows = people.map(person => {
        const row = document.createElement("tr");
        directoryConfig.fields.forEach(field => row.append(makeCell(person, field)));
        return row;
      });
      table.tBodies[0].replaceChildren(...rows);
      status.textContent = people.length ? "" : "No people found.";
    };
    directoryConfig.fields.forEach(field => {
      const th = document.createElement("th");
      const button = document.createElement("button");
      button.className = "sort-button";
      button.textContent = fieldLabels[field] || "Photo";
      if (field === "Picture") {
        button.textContent = "";
        button.setAttribute("aria-label", "Sort by photo");
      }
      button.addEventListener("click", () => {
        ascending = sortField === field ? !ascending : true;
        sortField = field;
        render();
      });
      th.append(button);
      header.append(th);
    });
    table.tHead.append(header);
    const buttons = document.getElementById("Filterbutton");
    const values = [...new Set(data.people.map(person => person[directoryConfig.buttonBy]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    ["", ...values].forEach(value => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = value || "All";
      button.addEventListener("click", () => { selected = value; render(); });
      buttons.append(button);
    });
    search.addEventListener("input", render);
    render();
  } catch (error) {
    status.textContent = `Directory unavailable: ${error.message}`;
  }
}

showDirectory();

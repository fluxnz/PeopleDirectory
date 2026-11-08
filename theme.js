"use strict";

const themeButton = document.getElementById("darkModeBtn");
function applyTheme(dark) {
  document.body.classList.toggle("dark", dark);
  themeButton.textContent = dark ? "Light Mode" : "Dark Mode";
}
applyTheme(document.cookie.split("; ").some(value => value === "darkMode=true"));
themeButton.addEventListener("click", () => {
  const dark = !document.body.classList.contains("dark");
  applyTheme(dark);
  document.cookie = `darkMode=${dark}; max-age=31536000; path=/; SameSite=Lax`;
});

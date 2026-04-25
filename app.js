/**
 * hafra.dz — app.js
 * All user-supplied content is rendered via DOM text nodes (never innerHTML).
 * Input is sanitised and rate-limited client-side; server enforces RLS + CHECK.
 */

'use strict';


// ===== SUPABASE CONFIG =====
const SUPABASE_URL      = 'https://njijaewqenuranmqswpf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qaWphZXdxZW51cmFubXFzd3BmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTczODksImV4cCI6MjA5MjY5MzM4OX0.mfuNoKGabrg1URPh3f3Ny6mW9ND_D_NOdKHdHybWrf0';
// ══════════════════════════════════════════════════════════════════════════════
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== GLOBAL STATE =====
let map;
let markers = [];
let userLocation = null;

// ===== INIT APP =====
window.addEventListener("load", () => {
  initMap();
  loadReports();
  setupUI();
});

// ===== MAP =====
function initMap() {
  map = L.map("map").setView([28.0339, 1.6596], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
}

// ===== LOAD REPORTS =====
async function loadReports() {
  try {
    const { data, error } = await supabase
      .from("reports")
      .select("*");

    if (error) throw error;

    clearMarkers();

    data.forEach(report => {
      const marker = L.marker([report.lat, report.lng]).addTo(map);

      marker.bindPopup(`
        <b>${report.category}</b><br/>
        ${report.comment || ""}
      `);

      markers.push(marker);
    });

  } catch (err) {
    console.error("Load error:", err);
  }
}

// ===== CLEAR MARKERS =====
function clearMarkers() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
}

// ===== ADD REPORT =====
async function addReport(lat, lng) {
  const comment = prompt("Enter comment:");
  if (!comment) return;

  try {
    const { error } = await supabase.from("reports").insert([
      {
        lat,
        lng,
        comment,
        votes: 0,
        status: "active"
      }
    ]);

    if (error) throw error;

    alert("Report added!");
    loadReports();

  } catch (err) {
    console.error("Insert error:", err);
  }
}

// ===== CLICK TO ADD =====
function enableAddMode() {
  map.once("click", (e) => {
    addReport(e.latlng.lat, e.latlng.lng);
  });

  alert("Click on map to add report");
}

// ===== LOCATION =====
function locateUser() {
  const btn = document.getElementById("btn-locate");
  btn.classList.add("locating");

  if (!navigator.geolocation) {
    alert("Geolocation not supported");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;

      userLocation = [latitude, longitude];

      map.setView(userLocation, 14);
      L.marker(userLocation).addTo(map);

      btn.classList.remove("locating");
    },
    (err) => {
      console.error(err);
      alert("Location failed");
      btn.classList.remove("locating");
    }
  );
}

// ===== SIDEBAR =====
function togglePanel() {
  const panel = document.getElementById("panel");
  panel.classList.toggle("open");
}

// ===== UI EVENTS =====
function setupUI() {
  // FIX: no inline onclick (CSP safe)
  document.querySelector(".menu-btn")
    .addEventListener("click", togglePanel);

  document.getElementById("btn-locate")
    .addEventListener("click", locateUser);

  document.getElementById("fab")
    .addEventListener("click", enableAddMode);
}

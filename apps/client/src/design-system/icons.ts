/**
 * Category glyphs, lifted verbatim from the prototype's ICONS map.
 * Flat line art, white on the category hue, legible at 16px.
 * No emoji, no fills — they must stay readable at every size.
 */
export const ICONS: Readonly<Record<string, string>> = Object.freeze({
  groceries: "<path d=\"M4 5h2l2.2 9.2a1.5 1.5 0 0 0 1.5 1.1h7.1a1.5 1.5 0 0 0 1.5-1.1L20 8H7\"/><circle cx=\"10\" cy=\"19\" r=\"1.2\"/><circle cx=\"17\" cy=\"19\" r=\"1.2\"/>",
  dining: "<path d=\"M6 3v7a2.5 2.5 0 0 0 5 0V3\"/><path d=\"M8.5 12.5V21\"/><path d=\"M17 3c1.4 1.9 2 4.6 2 7.5h-3.6c0-2.9.6-5.6 2-7.5z\"/><path d=\"M17.2 10.5V21\"/>",
  coffee: "<path d=\"M5 8h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z\"/><path d=\"M16 9.5h2a2.2 2.2 0 0 1 0 4.4h-2\"/><path d=\"M6 4.5v1.5M10 4v2M14 4.5v1.5\"/>",
  shopping: "<path d=\"M6.5 7h11l1 13H5.5z\"/><path d=\"M9 9.5V6a3 3 0 0 1 6 0v3.5\"/>",
  clothes: "<path d=\"M9 4l3 2 3-2 4.5 2.6L18 11l-2-1v10H8V10l-2 1-1.5-4.4z\"/>",
  transport: "<rect x=\"5\" y=\"4\" width=\"14\" height=\"12\" rx=\"3\"/><path d=\"M5 11h14\"/><path d=\"M8.5 19l-1.5 2M15.5 19l1.5 2\"/><path d=\"M8.5 13.8h.01M15.5 13.8h.01\"/><path d=\"M7.5 16h9\"/>",
  car: "<path d=\"M4 16.5h16\"/><path d=\"M5.5 16.5V12l1.8-4.2A1.6 1.6 0 0 1 8.8 7h6.4a1.6 1.6 0 0 1 1.5 1L18.5 12v4.5\"/><path d=\"M7 19.5v-3M17 19.5v-3\"/><path d=\"M8 12.5h8\"/>",
  fuel: "<path d=\"M5 20V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v14\"/><path d=\"M4 20h11\"/><path d=\"M6 10h7\"/><path d=\"M14 9h3a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0v-6l-2.5-3\"/>",
  travel: "<path d=\"M3 15l18-6.5-2-3-5.5 2L6 4 4 5l4.5 5.5L5 12l-2-1.5z\"/><path d=\"M6 20h12\"/>",
  hotel: "<path d=\"M4 20V6\"/><path d=\"M4 9h11a4 4 0 0 1 4 4v7\"/><path d=\"M4 15h15\"/><circle cx=\"8.5\" cy=\"11.5\" r=\"1.6\"/>",
  home: "<path d=\"M6 20V9.5l6-4.5 6 4.5V20\"/><path d=\"M10 20v-5h4v5\"/>",
  rent: "<path d=\"M3 10.5 12 4l9 6.5\"/><path d=\"M5.5 9.6V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.6\"/>",
  bills: "<path d=\"M12 3.5 19 6v5.5c0 4.2-2.9 7.4-7 8.5-4.1-1.1-7-4.3-7-8.5V6z\"/><path d=\"M9.2 12.2 11.3 14.3 15 10.5\"/>",
  utilities: "<path d=\"M13 2 4 14h7l-1 8 10-12h-7l1-8z\"/>",
  water: "<path d=\"M12 3.5c3.5 4.2 5.5 7.2 5.5 9.8A5.5 5.5 0 0 1 6.5 13.3C6.5 10.7 8.5 7.7 12 3.5z\"/>",
  phone: "<rect x=\"7\" y=\"3\" width=\"10\" height=\"18\" rx=\"2.5\"/><path d=\"M10.5 6.5h3\"/><path d=\"M11 18h2\"/>",
  wifi: "<path d=\"M3.5 9.5a13 13 0 0 1 17 0\"/><path d=\"M6.5 13a8.5 8.5 0 0 1 11 0\"/><path d=\"M9.5 16.4a4 4 0 0 1 5 0\"/><path d=\"M12 19.5h.01\"/>",
  subscription: "<path d=\"M4 12a8 8 0 0 1 13.7-5.6L20 8.5\"/><path d=\"M20 4v4.5h-4.5\"/><path d=\"M20 12a8 8 0 0 1-13.7 5.6L4 15.5\"/><path d=\"M4 20v-4.5h4.5\"/>",
  fun: "<rect x=\"3.5\" y=\"5.5\" width=\"17\" height=\"13\" rx=\"2.5\"/><path d=\"M8 5.5v13M16 5.5v13\"/><path d=\"M3.5 12h17\"/>",
  movie: "<rect x=\"3\" y=\"6\" width=\"18\" height=\"13\" rx=\"2.5\"/><path d=\"M3 10h18\"/><path d=\"M7.5 6l-1.5 4M13 6l-1.5 4M18.5 6L17 10\"/>",
  music: "<path d=\"M9 18V6l10-2v12\"/><circle cx=\"6.5\" cy=\"18\" r=\"2.5\"/><circle cx=\"16.5\" cy=\"16\" r=\"2.5\"/>",
  games: "<rect x=\"2.5\" y=\"7.5\" width=\"19\" height=\"9.5\" rx=\"4.5\"/><path d=\"M7 10.5v3M5.5 12h3\"/><circle cx=\"16\" cy=\"11.5\" r=\".9\"/><circle cx=\"18\" cy=\"13.8\" r=\".9\"/>",
  fitness: "<path d=\"M6.5 8v8M17.5 8v8\"/><path d=\"M4 10v4M20 10v4\"/><path d=\"M6.5 12h11\"/>",
  health: "<path d=\"M12 20s-7-4.4-7-9.4A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7 3C19 15.6 12 20 12 20z\"/>",
  pharmacy: "<rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"4\"/><path d=\"M12 8.5v7M8.5 12h7\"/>",
  education: "<path d=\"M12 4 2.5 8.5 12 13l9.5-4.5z\"/><path d=\"M6.5 10.7V16c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6v-5.3\"/>",
  kids: "<circle cx=\"12\" cy=\"7\" r=\"3\"/><path d=\"M6 20c0-3.4 2.7-6 6-6s6 2.6 6 6\"/><path d=\"M9.5 6.2h.01M14.5 6.2h.01\"/>",
  pets: "<circle cx=\"8\" cy=\"8\" r=\"1.9\"/><circle cx=\"16\" cy=\"8\" r=\"1.9\"/><circle cx=\"5\" cy=\"13\" r=\"1.7\"/><circle cx=\"19\" cy=\"13\" r=\"1.7\"/><path d=\"M12 12c2.6 0 4.6 2.2 4.6 4.5S14.6 20 12 20s-4.6-1.2-4.6-3.5S9.4 12 12 12z\"/>",
  gifts: "<rect x=\"3.5\" y=\"8.5\" width=\"17\" height=\"4\" rx=\"1\"/><path d=\"M5 12.5V20h14v-7.5\"/><path d=\"M12 8.5V20\"/><path d=\"M12 8.5S10.5 4 8.2 4a2.1 2.1 0 0 0 0 4.5zM12 8.5S13.5 4 15.8 4a2.1 2.1 0 0 1 0 4.5z\"/>",
  savings: "<path d=\"M4 11.5c0-3.6 3.6-6.5 8-6.5s8 2.9 8 6.5c0 2-1.1 3.8-2.8 5V19h-3v-1.6a11 11 0 0 1-4.4 0V19h-3v-2.5C5.1 15.3 4 13.5 4 11.5z\"/><path d=\"M16.5 10h.01\"/>",
  income: "<path d=\"M12 4.5v15\"/><path d=\"M15.5 8.2c-.6-1.4-2-2.2-3.5-2.2-2 0-3.5 1-3.5 2.8s1.6 2.4 3.5 2.9 3.7 1.1 3.7 3-1.7 3-3.7 3c-1.7 0-3.2-.9-3.8-2.4\"/>",
  transfer: "<path d=\"M4 8.5h13\"/><path d=\"M14 5.5l3 3-3 3\"/><path d=\"M20 15.5H7\"/><path d=\"M10 12.5l-3 3 3 3\"/>",
});

export const ICON_KEYS = Object.keys(ICONS);

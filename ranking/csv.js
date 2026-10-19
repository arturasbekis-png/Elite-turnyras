// CSV eksportas. Skirtukas „;“ ir UTF-8 BOM, kad Excel (lietuviška lokalė) teisingai atvertų lietuviškas raides.
// Langeliai, prasidedantys =, +, -, @, apsaugomi nuo formulių injekcijos.

const DELIMITER = ';';

function escapeCell(value) {
  if (value == null) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+([.,]\d+)?$/.test(text)) text = `'${text}`;
  if (/[";\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(header, rows) {
  const lines = [header, ...rows].map((row) => row.map(escapeCell).join(DELIMITER));
  return `﻿${lines.join('\r\n')}\r\n`;
}

const positionLabel = (r) => (r.tied ? `${r.position}=` : String(r.position));

/** Porų reitingas vienai kategorijai: viena eilutė porai. */
export function pairsCsv(rows) {
  return toCsv(
    ['Vieta', 'Žaidėjas 1', 'Žaidėjas 2', 'Taškai', 'Turnyrai', 'Pergalės', 'Antros vietos'],
    rows.map((r) => [positionLabel(r), r.names[0], r.names[1], r.points, r.played, r.wins, r.seconds]),
  );
}

/** Vieno turnyro rezultatai: viena eilutė porai (taškai skiriami porai vieną kartą). */
export function tournamentCsv(tournament, teams) {
  const rows = teams.map((team) => [tournament.name, tournament.date, team.position, team.teamName || '', team.players.map((p) => p.name).join(' / '), team.points]);
  return toCsv(['Turnyras', 'Data', 'Vieta', 'Komanda', 'Pora', 'Taškai porai'], rows);
}

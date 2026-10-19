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

export function overallCsv(rows) {
  return toCsv(
    ['Vieta', 'Žaidėjas', 'Taškai', 'ELITE turnyrai', 'CHALLENGE turnyrai', 'FUTURE turnyrai', 'Viso turnyrų', 'Pirmos vietos'],
    rows.map((r) => [positionLabel(r), r.name, r.points, r.played.elite, r.played.challenge, r.played.future, r.played.total, r.wins]),
  );
}

export function categoryCsv(rows) {
  return toCsv(
    ['Vieta', 'Žaidėjas', 'Taškai', 'Turnyrai', 'Pergalės', 'Antros vietos'],
    rows.map((r) => [positionLabel(r), r.name, r.points, r.played, r.wins, r.seconds]),
  );
}

/** Vieno turnyro rezultatai: viena eilutė žaidėjui. */
export function tournamentCsv(tournament, teams) {
  const rows = [];
  teams.forEach((team) => {
    team.players.forEach((player) => {
      rows.push([tournament.name, tournament.date, team.position, team.teamName || '', player.name, team.points]);
    });
  });
  return toCsv(['Turnyras', 'Data', 'Vieta', 'Komanda', 'Žaidėjas', 'Taškai'], rows);
}

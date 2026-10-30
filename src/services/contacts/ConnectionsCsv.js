// Reads LinkedIn's Connections.csv export (Settings, Data Privacy, Get a copy of your data, Connections), ported from
// career-ops' linkedin-join.mjs (parseCsv, findHeaderRow, parseConnectedOn, parseConnections). Same steps: a real CSV
// reader, since LinkedIn quotes any title with a comma in it; the header found by what it says, since the file opens
// with a "Notes:" blurb LinkedIn has changed before; cells read by column name, so a reordered export still lines up.
//
// career-ops is MIT licensed: Copyright (c) 2026 Santiago Fernández de Valderrama.
// https://github.com/career-ops-hq/career-ops/blob/main/linkedin-join.mjs

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// The columns we keep, by the name LinkedIn gives each one.
const COLUMNS = { first: "first name", last: "last name", url: "url", email: "email address", company: "company", position: "position", connected: "connected on" };

export class ConnectionsCsv
  {
    // Every connection with a name and a company, and counts of the rows that couldn't be used, so nothing is
    // dropped without a word.
    parse(text)
      {
        const quality = { noHeader: false, noCompany: 0, noName: 0, unparsedDates: 0 };
        const rows = this.rowsOf(text);
        const headerAt = this.headerIndex(rows);
        if(headerAt === -1) return { connections: [], quality: { ...quality, noHeader: true } };
        const columns = this.columnsOf(rows[headerAt]);
        const connections = [];
        for(const cells of rows.slice(headerAt + 1))
          {
            if(!cells.length || cells.every((cell) => !cell.trim())) continue;
            const connection = this.connectionOf(cells, columns);
            if(!connection.name) quality.noName++;
            else if(!connection.company) quality.noCompany++;
            else connections.push(connection);
            if(connection.name && connection.company && connection.connectedRaw && !connection.connectedOn) quality.unparsedDates++;
          }
        return { connections: connections.map(({ connectedRaw, ...connection }) => connection), quality };
      }

    // CSV text into rows of cells: quoted fields, doubled quotes, and line breaks inside quotes all handled. Written as
    // a loop over characters, not a regex, so a huge or odd file can't make it hang.
    rowsOf(text)
      {
        const source = String(text || "").replace(/^﻿/, "");
        const rows = [];
        let row = [];
        let field = "";
        let quoted = false;
        let i = 0;
        while(i < source.length)
          {
            const char = source[i];
            if(quoted)
              {
                if(char === "\"" && source[i + 1] === "\"")
                  {
                    field += "\"";
                    i += 2;
                  }
                else if(char === "\"")
                  {
                    quoted = false;
                    i++;
                  }
                else if(char === "\r" && source[i + 1] === "\n")
                  {
                    field += "\n";
                    i += 2;
                  }
                else
                  {
                    field += char;
                    i++;
                  }
                continue;
              }
            if(char === "\"") quoted = true;
            else if(char === ",")
              {
                row.push(field);
                field = "";
              }
            else if(char === "\n")
              {
                row.push(field);
                rows.push(row);
                row = [];
                field = "";
              }
            else if(char !== "\r") field += char;
            i++;
          }
        if(field !== "" || row.length)
          {
            row.push(field);
            rows.push(row);
          }
        return rows;
      }

    // The first row that names both "First Name" and "Company".
    headerIndex(rows)
      {
        return rows.findIndex((row) =>
          {
            const lower = row.map((cell) => cell.trim().toLowerCase());
            return lower.includes("first name") && lower.includes("company");
          });
      }

    // Where each column we keep sits in this export. -1 when it's missing.
    columnsOf(header)
      {
        const lower = header.map((cell) => cell.trim().toLowerCase());
        return Object.fromEntries(Object.entries(COLUMNS).map(([key, name]) => [key, lower.indexOf(name)]));
      }

    connectionOf(cells, columns)
      {
        const cell = (key) => (columns[key] !== -1 && cells[columns[key]] != null ? String(cells[columns[key]]).trim() : "");
        return {
          name: [cell("first"), cell("last")].filter(Boolean).join(" "),
          company: cell("company"),
          title: cell("position"),
          linkedin: cell("url"),
          email: cell("email"),
          connectedOn: this.dateOf(cell("connected")),
          connectedRaw: cell("connected"),
        };
      }

    // LinkedIn writes "03 Aug 2026". Gives back "2026-08-03", or "" when it isn't a real day: the pattern alone lets
    // "31 Feb" through, so the day goes through Date and has to come back as itself.
    dateOf(value)
      {
        const text = String(value || "").trim();
        if(/^\d{4}-\d{2}-\d{2}$/.test(text)) return this.realDay(text) ? text : "";
        const parts = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/.exec(text);
        const month = parts && MONTHS[parts[2].slice(0, 3).toLowerCase()];
        if(!month) return "";
        const day = `${parts[3]}-${String(month).padStart(2, "0")}-${String(Number(parts[1])).padStart(2, "0")}`;
        return this.realDay(day) ? day : "";
      }

    realDay(day)
      {
        const date = new Date(`${day}T00:00:00Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
      }
  }

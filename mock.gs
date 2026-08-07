/**
 * Simulador mínimo de los servicios de Apps Script, suficiente para ejecutar
 * el código del sistema de turnos fuera de Google y hacerle pruebas de humo.
 */
const crypto = require('crypto');

let llamadasHmac = 0;

function pad(n) { return ('0' + n).slice(-2); }
function formatear(d, patron) {
  return patron
    .replace('yyyy', d.getFullYear())
    .replace('MM', pad(d.getMonth() + 1))
    .replace('dd', pad(d.getDate()))
    .replace('HH', pad(d.getHours()))
    .replace('mm', pad(d.getMinutes()))
    .replace('ss', pad(d.getSeconds()));
}

/* ---------- Range ---------- */
class Range {
  constructor(hoja, fila, col, nFilas, nCols) {
    Object.assign(this, { hoja, fila, col, nFilas, nCols });
  }
  _asegurar(f, c) {
    while (this.hoja.datos.length < f) { this.hoja.datos.push([]); }
    const fila = this.hoja.datos[f - 1];
    while (fila.length < c) { fila.push(''); }
  }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nFilas; i++) {
      const fila = [];
      for (let j = 0; j < this.nCols; j++) {
        this._asegurar(this.fila + i, this.col + j);
        const v = this.hoja.datos[this.fila + i - 1][this.col + j - 1];
        fila.push(v === undefined ? '' : v);
      }
      out.push(fila);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(m) {
    m.forEach((fila, i) => fila.forEach((v, j) => {
      this._asegurar(this.fila + i, this.col + j);
      this.hoja.datos[this.fila + i - 1][this.col + j - 1] = v;
    }));
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  getA1Notation() { return 'R' + this.fila + 'C' + this.col; }
  setNumberFormat() { return this; }
  setDataValidation() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setVerticalAlignment() { return this; }
  getSheet() { return this.hoja; }
  getRow() { return this.fila; }
  getColumn() { return this.col; }
}

/* ---------- Sheet ---------- */
class Sheet {
  constructor(nombre) { this.nombre = nombre; this.datos = []; this.oculta = false; }
  getName() { return this.nombre; }
  getRange(f, c, nf, nc) { return new Range(this, f, c, nf || 1, nc || 1); }
  getLastRow() {
    let ultima = 0;
    this.datos.forEach((fila, i) => {
      if (fila.some(v => v !== '' && v !== undefined && v !== null)) { ultima = i + 1; }
    });
    return ultima;
  }
  getMaxRows() { return Math.max(this.datos.length, 1000); }
  getMaxColumns() { return Math.max(...this.datos.map(f => f.length), 26); }
  deleteColumns() { return this; }
  setFrozenRows() { return this; }
  setRowHeight() { return this; }
  autoResizeColumns() { return this; }
  hideSheet() { this.oculta = true; return this; }
  protect() { return { setWarningOnly: () => ({ setDescription: () => ({}) }) }; }
  appendRow(valores) { this.datos[this.getLastRow()] = valores.slice(); return this; }
}

/* ---------- Spreadsheet ---------- */
class Spreadsheet {
  constructor() { this.hojas = []; }
  getSheetByName(n) { return this.hojas.find(h => h.nombre === n) || null; }
  insertSheet(n) { const h = new Sheet(n); this.hojas.push(h); return h; }
  getSheets() { return this.hojas; }
  deleteSheet(h) { this.hojas = this.hojas.filter(x => x !== h); }
  setSpreadsheetTimeZone() { return this; }
  toast() { return this; }
}

const LIBRO = new Spreadsheet();
const alertas = [];

global.SpreadsheetApp = {
  getActiveSpreadsheet: () => LIBRO,
  openById: () => LIBRO,
  getActive: () => LIBRO,
  getUi: () => ({
    alert: (t, m) => { alertas.push(t + '\n' + m); },
    ButtonSet: { OK: 'OK' },
    createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} })
  }),
  newDataValidation: () => ({
    requireValueInList() { return this; },
    setAllowInvalid() { return this; },
    setHelpText() { return this; },
    build() { return {}; }
  })
};

global.Utilities = {
  formatDate: (d, tz, p) => formatear(d, p),
  newBlob: s => ({ getBytes: () => Array.from(Buffer.from(String(s), 'utf8')) }),
  base64Encode: b => Buffer.from(Array.isArray(b) ? Buffer.from(b) : Buffer.from(String(b), 'utf8')).toString('base64'),
  computeHmacSha256Signature: (v, k) => {
    llamadasHmac++;
    return Array.from(crypto.createHmac('sha256', Buffer.from(k)).update(Buffer.from(v)).digest());
  },
  computeDigest: (a, t) => Array.from(crypto.createHash('sha256').update(String(t)).digest()),
  getUuid: () => crypto.randomUUID(),
  DigestAlgorithm: { SHA_256: 1 },
  Charset: { UTF_8: 1 }
};

global.LockService = {
  getScriptLock: () => ({ waitLock: () => true, releaseLock: () => true })
};

const cache = {};
global.CacheService = {
  getScriptCache: () => ({
    get: k => (cache[k] === undefined ? null : cache[k]),
    put: (k, v) => { cache[k] = v; },
    remove: k => { delete cache[k]; }
  })
};

global.ScriptApp = {
  getProjectTriggers: () => [],
  newTrigger: () => ({
    forSpreadsheet() { return this; }, timeBased() { return this; },
    everyDays() { return this; }, atHour() { return this; },
    onEdit() { return this; }, create() { return {}; }
  })
};

global.Session = {
  getActiveUser: () => ({ getEmail: () => 'admin@empresa.com' }),
  getEffectiveUser: () => ({ getEmail: () => 'admin@empresa.com' })
};

global.HtmlService = {
  createTemplateFromFile: () => ({ evaluate: () => ({}) }),
  createHtmlOutputFromFile: () => ({ getContent: () => '' }),
  XFrameOptionsMode: { ALLOWALL: 1 }
};

module.exports = {
  LIBRO, alertas, cache,
  hmac: {
    reiniciar: () => { llamadasHmac = 0; },
    total: () => llamadasHmac
  }
};

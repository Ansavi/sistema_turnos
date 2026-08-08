/**
 * 04_Auditoria.gs
 * Traza inmutable de quién hizo qué. Dos fuentes:
 *  - APP: toda escritura que pasa por Db_ (crear, actualizar, anular, publicar).
 *  - HOJA: ediciones hechas directamente en la hoja de cálculo (trigger onEdit instalable).
 * También registra accesos y accesos denegados.
 */

var Auditoria_ = {

  registrar: function (ctx, accion, tabla, idRegistro, campo, antes, despues, resultado, detalle) {
    try {
      var hoja = SS_().getSheetByName(ESQUEMA_().AUDITORIA.hoja);
      if (!hoja) { return; }
      ctx = ctx || {};
      hoja.appendRow([
        'AUD-' + Utilities.getUuid().substring(0, 8).toUpperCase(),
        Utilidades_.ahora(),
        ctx.correo || 'desconocido',
        ctx.idUsuario || '',
        ctx.nivel || '',
        ctx.origen || 'APP',
        accion || '',
        tabla || '',
        idRegistro || '',
        campo || '',
        this._recortar(antes),
        this._recortar(despues),
        resultado || 'OK',
        this._recortar(detalle)
      ]);
    } catch (err) {
      console.error('No se pudo escribir en AUDITORIA: ' + err.message);
    }
  },

  _recortar: function (v) {
    if (v === null || v === undefined) { return ''; }
    var s;
    if (typeof v === 'object') {
      // En texto legible: la auditoría la lee una persona, no un programa.
      var partes = [];
      Object.keys(v).forEach(function (k) {
        if (v[k] !== '' && v[k] !== null && v[k] !== undefined) { partes.push(k + ': ' + v[k]); }
      });
      s = partes.join(' · ');
    } else {
      s = String(v);
    }
    return s.length > 800 ? s.substring(0, 797) + '...' : s;
  },

  /** Últimos movimientos, del más reciente al más antiguo. */
  consultar: function (filtros) {
    filtros = filtros || {};
    var filas = Db_.leer('AUDITORIA');
    var out = filas.filter(function (r) {
      if (filtros.correo && Utilidades_.normalizar(r.CORREO).indexOf(Utilidades_.normalizar(filtros.correo)) === -1) { return false; }
      if (filtros.tabla && r.TABLA !== filtros.tabla) { return false; }
      if (filtros.accion && r.ACCION !== filtros.accion) { return false; }
      if (filtros.desde && String(r.FECHA_HORA).substring(0, 10) < filtros.desde) { return false; }
      if (filtros.hasta && String(r.FECHA_HORA).substring(0, 10) > filtros.hasta) { return false; }
      return true;
    });
    out.reverse();
    return out.slice(0, filtros.limite || 300);
  }
};

/**
 * Trigger instalable (lo crea instalar()).
 * Captura cualquier cambio hecho a mano sobre las hojas del sistema.
 */
function auditarEdicionDirecta(e) {
  try {
    if (!e || !e.range) { return; }
    var hoja = e.range.getSheet();
    var nombreHoja = hoja.getName();
    var esquema = ESQUEMA_();
    var tabla = null;
    Object.keys(esquema).forEach(function (k) {
      if (esquema[k].hoja === nombreHoja) { tabla = k; }
    });
    if (!tabla || tabla === 'AUDITORIA') { return; }

    var def = esquema[tabla];
    var fila = e.range.getRow();
    if (fila === 1) { return; }

    var col = e.range.getColumn();
    var campo = (def.campos[col - 1] || {}).c || ('COL' + col);
    var idRegistro = hoja.getRange(fila, 1).getValue();

    var correo = '';
    try { correo = e.user ? e.user.getEmail() : ''; } catch (ignore) {}

    var ctx = { correo: correo || Session.getActiveUser().getEmail() || 'desconocido', origen: 'HOJA' };
    var sesion = Auth_.perfilPorCorreo(ctx.correo);
    if (sesion) { ctx.idUsuario = sesion.idUsuario; ctx.nivel = sesion.nivel; }

    Auditoria_.registrar(ctx, 'EDICION_DIRECTA', tabla, idRegistro, campo,
      e.oldValue, e.value, 'OK', 'Celda ' + e.range.getA1Notation());
  } catch (err) {
    console.error('auditarEdicionDirecta: ' + err.message);
  }
}

/**
 * 14_Reparacion.gs
 * Reparación del orden de columnas y acceso de emergencia.
 *
 * POR QUÉ EXISTE
 * La migración a la versión 2.0 añadía las columnas nuevas al final de cada hoja,
 * pero la capa de datos lee por POSICIÓN, no por nombre. Si el esquema declara
 * FECHA_CESE antes de ESTADO_PERSONAL y en la hoja quedó al final, el sistema lee
 * el estado de la columna equivocada: lo ve vacío y considera inactivo al usuario.
 *
 * `repararOrdenColumnas` reordena físicamente cada hoja para que coincida con el
 * esquema, conservando todos los datos.
 *
 * DÓNDE SE EJECUTA: Editor Apps Script → elegir la función → Ejecutar,
 * y leer el resultado en el panel "Registro de ejecución".
 */

/**
 * ACCESO DE EMERGENCIA. Ejecuta esta única función si no puedes entrar al sistema.
 * Repara el orden de las columnas, reactiva al administrador y le genera una
 * contraseña temporal nueva.
 */
function emergenciaAdmin() {
  var pasos = [];
  var anotar = function (t) { pasos.push('  ' + t); console.log(t); };

  anotar('1. Reparando el orden de las columnas…');
  var arregladas = repararOrdenColumnas(anotar);

  anotar('2. Reactivando al administrador…');
  var acceso = reactivarAdmin_(anotar);

  var texto = 'ACCESO DE EMERGENCIA\n' + '='.repeat(50) + '\n' +
              pasos.join('\n') + '\n' + '='.repeat(50) + '\n' +
              'Hojas reordenadas: ' + arregladas.length +
              (arregladas.length ? ' (' + arregladas.join(', ') + ')' : '') + '\n\n' +
              (acceso
                ? 'Usuario: ' + acceso.usuarioLogin + '\n' +
                  'Contraseña temporal: ' + acceso.claveTemporal + '\n\n' +
                  'Anótala: no se puede volver a mostrar. Se pedirá cambiarla al ingresar.'
                : 'No se encontró un administrador que reparar.');

  console.log(texto);
  try {
    SpreadsheetApp.getUi().alert('Acceso de emergencia', texto, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (ignore) { /* ejecutado desde el editor: basta el registro */ }
  return texto;
}

/**
 * Reordena las columnas de cada hoja para que coincidan con el esquema.
 * Conserva todos los datos: los reubica según el NOMBRE del encabezado, no su
 * posición, así que ninguna celda cambia de significado.
 * Es seguro ejecutarla varias veces: si una hoja ya está en orden, la salta.
 */
function repararOrdenColumnas(anotar) {
  anotar = anotar || function (t) { console.log(t); };
  var ss = SS_();
  var esquema = ESQUEMA_();
  var arregladas = [];

  ORDEN_HOJAS_().forEach(function (clave) {
    var def = esquema[clave];
    var hoja = ss.getSheetByName(def.hoja);
    if (!hoja) { return; }

    var esperados = def.campos.map(function (f) { return f.c; });
    var ultimaCol = Math.max(hoja.getLastColumn(), 1);
    var actuales = hoja.getRange(1, 1, 1, ultimaCol).getValues()[0]
                       .map(function (v) { return String(v).trim(); });

    var enOrden = esperados.length === actuales.filter(function (c) { return c !== ''; }).length &&
                  esperados.every(function (c, i) { return actuales[i] === c; });
    if (enOrden) { return; }

    var nFilas = Math.max(hoja.getLastRow() - 1, 0);
    var datos = nFilas ? hoja.getRange(2, 1, nFilas, ultimaCol).getValues() : [];

    // Índice por nombre de encabezado: es lo que permite reubicar sin perder nada.
    var posicion = {};
    actuales.forEach(function (c, i) { if (c) { posicion[c] = i; } });

    var huerfanas = actuales.filter(function (c) {
      return c && esperados.indexOf(c) === -1;
    });

    var reordenados = datos.map(function (fila) {
      return esperados.map(function (c) {
        return posicion[c] !== undefined ? fila[posicion[c]] : '';
      });
    });

    hoja.clear();
    hoja.getRange(1, 1, 1, esperados.length).setValues([esperados]);
    if (reordenados.length) {
      hoja.getRange(2, 1, reordenados.length, esperados.length).setValues(reordenados);
    }
    prepararHoja_(hoja, def);

    arregladas.push(def.hoja);
    anotar('   ' + def.hoja + ': ' + esperados.length + ' columnas reordenadas, ' +
           nFilas + ' fila(s) conservadas' +
           (huerfanas.length ? ' · columnas descartadas: ' + huerfanas.join(', ') : ''));
  });

  if (!arregladas.length) { anotar('   Todas las hojas ya estaban en orden.'); }
  SpreadsheetApp.flush();
  return arregladas;
}

/**
 * Devuelve el acceso al administrador: lo reactiva y le genera contraseña temporal.
 * Si no hay ningún usuario ADMIN, promueve al primer usuario existente.
 */
function reactivarAdmin_(anotar) {
  anotar = anotar || function (t) { console.log(t); };

  var usuarios = Db_.leer('USUARIO');
  if (!usuarios.length) { anotar('   No hay usuarios registrados.'); return null; }

  var admin = usuarios.filter(function (u) {
    return String(u.NIVEL_ACCESO).toUpperCase() === 'ADMIN';
  })[0] || usuarios[0];

  if (String(admin.NIVEL_ACCESO).toUpperCase() !== 'ADMIN') {
    Seg_.guardar('USUARIO', admin.IDUSUARIO, { NIVEL_ACCESO: 'ADMIN' });
    anotar('   ' + admin.IDUSUARIO + ' promovido a ADMIN');
  }
  if (String(admin.ESTADO_USUARIO).toUpperCase() !== 'ACTIVO') {
    Seg_.guardar('USUARIO', admin.IDUSUARIO, { ESTADO_USUARIO: 'ACTIVO' });
    anotar('   usuario reactivado');
  }

  var persona = Db_.buscarPorId('PERSONAL', admin.IDPERSONAL);
  if (persona) {
    var cambios = {};
    if (String(persona.ESTADO_PERSONAL).toUpperCase() !== 'ACTIVO') {
      cambios.ESTADO_PERSONAL = 'ACTIVO';
    }
    if (persona.FECHA_CESE) { cambios.FECHA_CESE = ''; }
    if (Object.keys(cambios).length) {
      Seg_.guardar('PERSONAL', persona.IDPERSONAL, cambios);
      anotar('   personal reactivado: ' + persona.NOMBRES + ' ' + persona.APELLIDOS);
    }
  }

  var cred = Db_.buscarPor('CREDENCIAL', 'IDUSUARIO', admin.IDUSUARIO);
  var temporal = Politica_.temporal();
  var salt = Cripto_.salt();
  var iter = SEGURIDAD_().ITERACIONES;
  var hash = Cripto_.derivar(temporal, salt, iter);

  if (cred) {
    Seg_.guardar('CREDENCIAL', cred.IDCREDENCIAL, {
      SALT: salt, ITERACIONES: iter, HASH: hash, DEBE_CAMBIAR: 'SI',
      FECHA_CAMBIO: Utilidades_.ahora(), INTENTOS_FALLIDOS: 0, BLOQUEADO_HASTA: '',
      ESTADO_CREDENCIAL: 'ACTIVA'
    });
  } else {
    cred = Seg_.crear('CREDENCIAL', {
      IDUSUARIO: admin.IDUSUARIO, USUARIO_LOGIN: 'admin',
      HASH: hash, SALT: salt, ITERACIONES: iter, HISTORIAL: '[]',
      DEBE_CAMBIAR: 'SI', FECHA_CAMBIO: Utilidades_.ahora(),
      INTENTOS_FALLIDOS: 0, BLOQUEADO_HASTA: '', ULTIMO_ACCESO: '',
      ESTADO_CREDENCIAL: 'ACTIVA', OBSERVACIONES: 'Recreada por emergenciaAdmin()'
    });
    anotar('   credencial recreada');
  }

  // Cierra las sesiones abiertas: la contraseña anterior ya no vale.
  Auth_._cerrarSesionesDe(admin.IDUSUARIO, 'Acceso de emergencia');

  Auditoria_.registrar(
    { correo: Session.getEffectiveUser().getEmail(), nivel: 'ADMIN', origen: 'MANTENIMIENTO' },
    'EMERGENCIA', 'CREDENCIAL', cred.IDCREDENCIAL, '', '', '', 'OK',
    'Acceso restablecido para ' + cred.USUARIO_LOGIN);

  return { usuarioLogin: cred.USUARIO_LOGIN, claveTemporal: temporal };
}

/**
 * Comprueba si alguna hoja tiene las columnas fuera del orden del esquema.
 * No modifica nada: solo informa.
 */
function revisarOrdenColumnas() {
  var ss = SS_();
  var esquema = ESQUEMA_();
  var lineas = [];
  var problemas = 0;

  ORDEN_HOJAS_().forEach(function (clave) {
    var def = esquema[clave];
    var hoja = ss.getSheetByName(def.hoja);
    if (!hoja) { lineas.push('  FALTA  ' + def.hoja); problemas++; return; }

    var esperados = def.campos.map(function (f) { return f.c; });
    var ultimaCol = Math.max(hoja.getLastColumn(), 1);
    var actuales = hoja.getRange(1, 1, 1, ultimaCol).getValues()[0]
                       .map(function (v) { return String(v).trim(); });

    var desorden = [];
    esperados.forEach(function (c, i) {
      if (actuales[i] !== c) { desorden.push('col ' + (i + 1) + ': hay "' + (actuales[i] || 'vacío') + '", debe ir "' + c + '"'); }
    });

    if (desorden.length) {
      problemas++;
      lineas.push('  MAL    ' + def.hoja + ' → ' + desorden.slice(0, 3).join(' · ') +
                  (desorden.length > 3 ? ' … y ' + (desorden.length - 3) + ' más' : ''));
    } else {
      lineas.push('  OK     ' + def.hoja);
    }
  });

  var texto = 'ORDEN DE COLUMNAS\n' + '='.repeat(50) + '\n' + lineas.join('\n') +
              '\n' + '='.repeat(50) + '\n' +
              (problemas ? problemas + ' hoja(s) con problemas. Ejecuta repararOrdenColumnas.'
                         : 'Todas las hojas coinciden con el esquema.');
  console.log(texto);
  return texto;
}

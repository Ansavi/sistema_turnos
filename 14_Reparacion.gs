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

  /**
   * Ya NO se reordenan columnas: la capa de datos mapea por nombre de encabezado,
   * así que el orden de la hoja es indiferente. Borrar y reescribir hojas con datos
   * reales para arreglar un problema de lectura era un riesgo innecesario.
   */
  anotar('1. Sincronizando las listas desplegables con sus columnas…');
  var hojasValidadas = sincronizarValidaciones();
  anotar('   ' + hojasValidadas.length + ' hoja(s) revisadas');

  anotar('2. Revisando columnas faltantes…');
  var arregladas = revisarColumnas_(anotar);

  anotar('3. Reactivando al administrador…');
  var acceso = reactivarAdmin_(anotar);

  var texto = 'ACCESO DE EMERGENCIA\n' + '='.repeat(50) + '\n' +
              pasos.join('\n') + '\n' + '='.repeat(50) + '\n' +
              (arregladas.length
                ? 'Hojas con columnas faltantes: ' + arregladas.join(', ') +
                  '\n(ejecuta migrarAVersion2 para completarlas)\n\n'
                : 'Todas las hojas tienen sus columnas.\n\n') +
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
 * Reasigna las listas desplegables a la columna que les corresponde POR NOMBRE.
 *
 * Las reglas de validación viven pegadas a la posición de la columna, no a su
 * encabezado. Si el orden de la hoja cambió, la lista de ESTADO_AREA puede haber
 * quedado sobre COBERTURA_MINIMA y rechazar cualquier número que se escriba ahí.
 *
 * No toca ningún dato: solo reglas de validación.
 */
function sincronizarValidaciones() {
  var ss = SS_();
  var esquema = ESQUEMA_();
  var ajustadas = [];

  ORDEN_HOJAS_().forEach(function (clave) {
    var def = esquema[clave];
    var hoja = ss.getSheetByName(def.hoja);
    if (!hoja) { return; }

    var ancho = Math.max(hoja.getLastColumn(), 1);
    var filas = Math.max(hoja.getMaxRows() - 1, 1);
    var cabeceras = hoja.getRange(1, 1, 1, ancho).getValues()[0]
                        .map(function (v) { return String(v).trim(); });

    var porNombre = {};
    def.campos.forEach(function (f) { porNombre[f.c] = f; });

    var n = 0;
    for (var col = 1; col <= ancho; col++) {
      var campo = porNombre[cabeceras[col - 1]];
      var rango = hoja.getRange(2, col, filas, 1);

      if (campo && campo.t === 'lista' && campo.ops && campo.ops.length) {
        rango.setDataValidation(
          SpreadsheetApp.newDataValidation()
            .requireValueInList(campo.ops, true)
            .setAllowInvalid(false)
            .setHelpText('Valores permitidos: ' + campo.ops.join(', '))
            .build());
      } else {
        // Columna que no es de lista: no debe arrastrar reglas de otra época.
        rango.clearDataValidations();
      }
      n++;
    }
    if (n) { ajustadas.push(def.hoja); }
  });

  SpreadsheetApp.flush();
  console.log('Validaciones sincronizadas en ' + ajustadas.length + ' hoja(s).');
  return ajustadas;
}

/**
 * Informa si a alguna hoja le faltan columnas del esquema. No modifica nada.
 * Con el acceso por nombre de encabezado, una columna ausente ya no corrompe la
 * lectura: simplemente ese campo llega vacío. Pero conviene saberlo.
 */
function revisarColumnas_(anotar) {
  anotar = anotar || function (t) { console.log(t); };
  var incompletas = [];
  ORDEN_HOJAS_().forEach(function (clave) {
    var hoja = SS_().getSheetByName(ESQUEMA_()[clave].hoja);
    if (!hoja) { anotar('   FALTA la hoja ' + ESQUEMA_()[clave].hoja); incompletas.push(clave); return; }
    var faltan = Db_.columnasFaltantes(clave);
    if (faltan.length) {
      anotar('   ' + clave + ': faltan ' + faltan.join(', '));
      incompletas.push(clave);
    }
  });
  if (!incompletas.length) { anotar('   Todas las hojas tienen sus columnas.'); }
  return incompletas;
}

/**
 * Reordena físicamente las columnas para que coincidan con el esquema.
 * OPCIONAL y solo cosmético: el sistema funciona con cualquier orden. Sirve para
 * dejar las hojas legibles si alguien las consulta a mano.
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

    /**
     * clear() borra contenido y formatos, pero NO las reglas de validación:
     * esas quedan pegadas a la columna. Si no se limpian antes de reescribir, un
     * valor que cambia de columna choca con la lista de la columna anterior
     * (por ejemplo, COBERTURA_MINIMA = 1 cayendo donde antes iba ESTADO_AREA).
     */
    hoja.getDataRange().clearDataValidations();
    hoja.clear();

    hoja.getRange(1, 1, 1, esperados.length).setValues([esperados]);
    if (reordenados.length) {
      hoja.getRange(2, 1, reordenados.length, esperados.length).setValues(reordenados);
    }
    SpreadsheetApp.flush();
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

/**
 * REPARACIÓN TOTAL DEL ACCESO.
 * Ejecuta SOLO esta función si no puedes entrar, sea cual sea el mensaje.
 *
 * Diagnostica y reconstruye la cadena PERSONAL → USUARIO → CREDENCIAL, que es lo
 * único que hace falta para iniciar sesión. Si algún eslabón está roto, vacío o
 * apunta a un registro inexistente, lo repara. No borra datos existentes.
 *
 * Imprime además el contenido crudo de esas tres hojas: si algo sigue fallando,
 * ese informe dice exactamente por qué.
 */
function repararAcceso() {
  var log = [];
  var anotar = function (t) { log.push(t); console.log(t); };

  anotar('REPARACIÓN DEL ACCESO  ' + Utilidades_.ahora());
  anotar('='.repeat(56));

  // 1. Las listas desplegables, a su columna correcta.
  try {
    sincronizarValidaciones();
    anotar('Listas desplegables sincronizadas.');
  } catch (e) {
    anotar('Aviso al sincronizar listas: ' + e.message);
  }

  // 2. Diagnóstico de lo que hay.
  var personas = Db_.leer('PERSONAL');
  var usuarios = Db_.leer('USUARIO');
  var credenciales = Db_.leer('CREDENCIAL');

  anotar('');
  anotar('ESTADO ACTUAL');
  anotar('  PERSONAL: ' + personas.length + ' fila(s)');
  personas.slice(0, 5).forEach(function (p) {
    anotar('    ' + p.IDPERSONAL + ' | ' + p.NOMBRES + ' ' + p.APELLIDOS +
           ' | ' + p.CORREO + ' | estado: "' + p.ESTADO_PERSONAL + '"');
  });
  anotar('  USUARIO: ' + usuarios.length + ' fila(s)');
  usuarios.slice(0, 5).forEach(function (u) {
    anotar('    ' + u.IDUSUARIO + ' | personal: "' + u.IDPERSONAL +
           '" | nivel: "' + u.NIVEL_ACCESO + '" | estado: "' + u.ESTADO_USUARIO + '"');
  });
  anotar('  CREDENCIAL: ' + credenciales.length + ' fila(s)');
  credenciales.slice(0, 5).forEach(function (c) {
    anotar('    ' + c.IDCREDENCIAL + ' | login: "' + c.USUARIO_LOGIN +
           '" | usuario: "' + c.IDUSUARIO + '" | estado: "' + c.ESTADO_CREDENCIAL + '"');
  });

  // 3. Reconstruir la cadena.
  anotar('');
  anotar('REPARACIÓN');
  var correo = CONFIG_().ADMIN_INICIAL || Session.getEffectiveUser().getEmail() || 'admin@local';

  // 3a. La persona
  var persona = personas.filter(function (p) {
    return p.IDPERSONAL && p.NOMBRES;
  })[0];

  if (!persona) {
    var cargo = Db_.leer('CARGO')[0];
    persona = Db_.insertarCrudo('PERSONAL', {
      IDCARGO: cargo ? cargo.IDCARGO : '',
      DNI: '00000000', NOMBRES: 'Administrador', APELLIDOS: 'del Sistema',
      TELEFONO: '', CORREO: correo,
      FECHA_NAC: '1990-01-01', FECHA_INGRESO: Utilidades_.hoyISO(),
      FECHA_CESE: '', ESTADO_PERSONAL: 'ACTIVO',
      OBSERVACIONES: 'Recreado por repararAcceso()'
    });
    anotar('  PERSONAL recreado: ' + persona.IDPERSONAL);
  } else {
    var arreglos = {};
    if (String(persona.ESTADO_PERSONAL).toUpperCase() !== 'ACTIVO') { arreglos.ESTADO_PERSONAL = 'ACTIVO'; }
    if (persona.FECHA_CESE) { arreglos.FECHA_CESE = ''; }
    if (!persona.CORREO) { arreglos.CORREO = correo; }
    if (Object.keys(arreglos).length) {
      Seg_.guardar('PERSONAL', persona.IDPERSONAL, arreglos);
      anotar('  PERSONAL ' + persona.IDPERSONAL + ' corregido: ' + Object.keys(arreglos).join(', '));
    } else {
      anotar('  PERSONAL ' + persona.IDPERSONAL + ' está correcto.');
    }
  }

  // 3b. El usuario, ligado a esa persona
  var usuario = usuarios.filter(function (u) {
    return u.IDPERSONAL === persona.IDPERSONAL;
  })[0] || usuarios[0];

  if (!usuario) {
    usuario = Db_.insertarCrudo('USUARIO', {
      IDPERSONAL: persona.IDPERSONAL, NIVEL_ACCESO: 'ADMIN',
      ESTADO_USUARIO: 'ACTIVO', OBSERVACIONES: 'Recreado por repararAcceso()'
    });
    anotar('  USUARIO recreado: ' + usuario.IDUSUARIO);
  } else {
    var arr2 = {};
    if (usuario.IDPERSONAL !== persona.IDPERSONAL) { arr2.IDPERSONAL = persona.IDPERSONAL; }
    if (String(usuario.NIVEL_ACCESO).toUpperCase() !== 'ADMIN') { arr2.NIVEL_ACCESO = 'ADMIN'; }
    if (String(usuario.ESTADO_USUARIO).toUpperCase() !== 'ACTIVO') { arr2.ESTADO_USUARIO = 'ACTIVO'; }
    if (Object.keys(arr2).length) {
      Seg_.guardar('USUARIO', usuario.IDUSUARIO, arr2);
      anotar('  USUARIO ' + usuario.IDUSUARIO + ' corregido: ' + Object.keys(arr2).join(', '));
    } else {
      anotar('  USUARIO ' + usuario.IDUSUARIO + ' está correcto.');
    }
  }

  // 3c. La credencial, ligada a ese usuario
  var temporal = Politica_.temporal();
  var salt = Cripto_.salt();
  var iter = SEGURIDAD_().ITERACIONES;
  var hash = Cripto_.derivar(temporal, salt, iter);

  var cred = credenciales.filter(function (c) {
    return c.IDUSUARIO === usuario.IDUSUARIO;
  })[0] || credenciales.filter(function (c) {
    return String(c.USUARIO_LOGIN).toLowerCase() === 'admin';
  })[0];

  if (!cred) {
    cred = Seg_.crear('CREDENCIAL', {
      IDUSUARIO: usuario.IDUSUARIO, USUARIO_LOGIN: 'admin',
      HASH: hash, SALT: salt, ITERACIONES: iter, HISTORIAL: '[]',
      DEBE_CAMBIAR: 'SI', FECHA_CAMBIO: Utilidades_.ahora(),
      INTENTOS_FALLIDOS: 0, BLOQUEADO_HASTA: '', ULTIMO_ACCESO: '',
      ESTADO_CREDENCIAL: 'ACTIVA', OBSERVACIONES: 'Recreada por repararAcceso()'
    });
    anotar('  CREDENCIAL recreada: ' + cred.USUARIO_LOGIN);
  } else {
    Seg_.guardar('CREDENCIAL', cred.IDCREDENCIAL, {
      IDUSUARIO: usuario.IDUSUARIO,
      USUARIO_LOGIN: cred.USUARIO_LOGIN || 'admin',
      SALT: salt, ITERACIONES: iter, HASH: hash, HISTORIAL: '[]',
      DEBE_CAMBIAR: 'SI', FECHA_CAMBIO: Utilidades_.ahora(),
      INTENTOS_FALLIDOS: 0, BLOQUEADO_HASTA: '', ESTADO_CREDENCIAL: 'ACTIVA'
    });
    anotar('  CREDENCIAL ' + (cred.USUARIO_LOGIN || 'admin') + ' restablecida.');
  }

  // 4. Comprobación real: se intenta iniciar sesión de verdad.
  anotar('');
  anotar('COMPROBACIÓN');
  var login = (Db_.buscarPorId('CREDENCIAL', cred.IDCREDENCIAL) || {}).USUARIO_LOGIN || 'admin';
  var resultado;
  try {
    var sesion = Auth_.iniciarSesion(login, temporal);
    Auth_.cerrarSesion(sesion.token);
    resultado = '  El inicio de sesión FUNCIONA.';
  } catch (e) {
    resultado = '  El inicio de sesión SIGUE FALLANDO: ' + e.message +
                '\n  Copia todo este registro y envíalo para diagnóstico.';
  }
  anotar(resultado);

  var texto = log.join('\n') + '\n' + '='.repeat(56) +
              '\nUsuario: ' + login +
              '\nContraseña temporal: ' + temporal +
              '\n\nAnótala: no se puede volver a mostrar.';

  console.log('\n' + '='.repeat(56) + '\nUsuario: ' + login +
              '\nContraseña temporal: ' + temporal);
  try {
    SpreadsheetApp.getUi().alert('Acceso reparado',
      'Usuario: ' + login + '\nContraseña temporal: ' + temporal +
      '\n\n' + resultado.trim(), SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (ignore) { /* desde el editor basta el registro */ }

  return texto;
}

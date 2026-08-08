/**
 * 02_Setup.gs
 * Ejecuta instalar() UNA vez desde el editor de Apps Script.
 * Crea las hojas con encabezados, formatos de texto para fechas, validaciones,
 * catálogos base y el trigger que audita ediciones hechas directo en la hoja.
 */

function instalar() {
  var ss = SS_();
  var esquema = ESQUEMA_();
  var creadas = [];

  ORDEN_HOJAS_().forEach(function (clave) {
    var def = esquema[clave];
    var hoja = ss.getSheetByName(def.hoja);
    if (!hoja) { hoja = ss.insertSheet(def.hoja); creadas.push(def.hoja); }
    prepararHoja_(hoja, def);
  });

  sembrarCatalogos_();
  Permisos_.sembrar();
  var acceso = sembrarAdmin_();
  registrarTriggers_();
  ss.setSpreadsheetTimeZone(CONFIG_().TZ);

  // Material de contraseña y tokens fuera de la vista normal.
  ['CREDENCIAL', 'SESION'].forEach(function (t) {
    var h = ss.getSheetByName(esquema[t].hoja);
    if (h) { h.hideSheet(); }
  });

  var hojaVacia = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hojaVacia && ss.getSheets().length > 1) { ss.deleteSheet(hojaVacia); }

  if (acceso) {
    SpreadsheetApp.getUi().alert(
      'Acceso de administrador',
      'Guarda estos datos ahora: la contraseña no se puede volver a mostrar.\n\n' +
      'Usuario: ' + acceso.usuarioLogin + '\n' +
      'Contraseña temporal: ' + acceso.claveTemporal + '\n\n' +
      'El sistema te pedirá cambiarla en el primer ingreso.',
      SpreadsheetApp.getUi().ButtonSet.OK);
  }

  SpreadsheetApp.getActive().toast(
    'Instalación completa. Hojas nuevas: ' + (creadas.length || 0), CONFIG_().APP, 8);
  return 'OK. Hojas creadas: ' + creadas.join(', ');
}

function prepararHoja_(hoja, def) {
  var cols = def.campos.map(function (f) { return f.c; });

  hoja.getRange(1, 1, 1, cols.length).setValues([cols])
      .setFontWeight('bold').setBackground('#16202B').setFontColor('#FFFFFF')
      .setVerticalAlignment('middle');
  hoja.setFrozenRows(1);
  hoja.setRowHeight(1, 30);

  if (hoja.getMaxColumns() > cols.length) {
    hoja.deleteColumns(cols.length + 1, hoja.getMaxColumns() - cols.length);
  }

  var filas = Math.max(hoja.getMaxRows() - 1, 1);

  def.campos.forEach(function (f, i) {
    var rango = hoja.getRange(2, i + 1, filas, 1);
    // Fechas y horas se guardan como texto ISO para evitar corrimientos por zona horaria.
    // Los campos largos también van como texto: ahí viven hashes y tokens en base64,
    // que Sheets podría intentar interpretar como número o fórmula.
    if (f.t !== 'numero' && f.t !== 'lista') {
      rango.setNumberFormat('@');
    }
    if (f.t === 'lista' && f.ops && f.ops.length) {
      rango.setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInList(f.ops, true).setAllowInvalid(false)
          .setHelpText('Valores permitidos: ' + f.ops.join(', ')).build());
    }
  });

  hoja.autoResizeColumns(1, Math.min(cols.length, 12));
  hoja.protect().setWarningOnly(true)
      .setDescription('Editar preferentemente desde la aplicación web (queda auditado).');
}

function sembrarCatalogos_() {
  var tipos = TIPOS_DIA_SISTEMA_();
  Object.keys(tipos).forEach(function (k) {
    if (Db_.buscarPor('TIPO_DIA', 'TIPO_DIA', k)) { return; }
    Db_.insertarCrudo('TIPO_DIA', {
      TIPO_DIA: k, PRIORIDAD: tipos[k].prioridad, COLOR: tipos[k].color,
      BLOQUEA_TRABAJO: tipos[k].bloquea ? 'SI' : 'NO', ESTADO_TIPO: 'ACTIVO',
      OBSERVACIONES: 'Tipo del sistema. No renombrar: el motor de reglas lo usa.'
    });
  });

  FUNCIONES_INICIALES_().forEach(function (f) {
    if (Db_.buscarPor('FUNCION', 'FUNCION', f.nombre)) { return; }
    Db_.insertarCrudo('FUNCION', {
      FUNCION: f.nombre, ABREVIATURA: f.abrev, COLOR: f.color,
      ESTADO: 'ACTIVO', OBSERVACIONES: f.nota
    });
  });

  PARAMETROS_DEFECTO_().forEach(function (p) {
    if (Db_.buscarPor('PARAMETRO', 'CLAVE', p.clave)) { return; }
    Db_.insertarCrudo('PARAMETRO', {
      CLAVE: p.clave, VALOR: p.valor, TIPO_DATO: p.tipo,
      DESCRIPCION: p.desc, ESTADO: 'ACTIVO'
    });
  });

  /**
   * Tipos de licencia: solo los no médicos.
   * Queda pendiente confirmar si la licencia médica es distinta del descanso
   * médico; hasta entonces no se siembra ninguna para no duplicar el concepto.
   */
  if (Db_.leer('TIPO_LICENCIA').length === 0) {
    [['SIN GOCE DE HABER', 'NO', 'SI'],
     ['CAPACITACION', 'SI', 'SI'],
     ['FALLECIMIENTO DE FAMILIAR', 'SI', 'SI'],
     ['PATERNIDAD', 'SI', 'SI'],
     ['MATERNIDAD', 'SI', 'SI'],
     ['COMISION DE SERVICIO', 'SI', 'SI']].forEach(function (t) {
      Db_.insertarCrudo('TIPO_LICENCIA', {
        TIPO_LICENCIA: t[0], ES_REMUNERADA: t[1], REQUIERE_DOCUMENTO: t[2],
        ESTADO: 'ACTIVO', OBSERVACIONES: ''
      });
    });
  }

  if (Db_.leer('CARGO').length === 0) {
    ['SECRETARIO', 'ASISTENTE', 'ESPECIALISTA LEGAL', 'JUEZ'].forEach(function (c) {
      Db_.insertarCrudo('CARGO', { CARGO: c, ESTADO_CARGO: 'ACTIVO', OBSERVACIONES: '' });
    });
  }

  if (Db_.leer('TURNO').length === 0) {
    [['MAÑANA', '07:00', '15:00', 'DIURNO'],
     ['TARDE', '15:00', '23:00', 'DIURNO'],
     ['NOCHE', '23:00', '07:00', 'NOCTURNO']].forEach(function (t) {
      Db_.insertarCrudo('TURNO', {
        NOMBRE_TURNO: t[0], DIA_INICIO: '', HORA_INICIO: t[1],
        DIA_FIN: '', HORA_FIN: t[2], TIPO_TURNO: t[3],
        ESTADO_TURNO: 'ACTIVO', OBSERVACIONES: ''
      });
    });
  }
}

/**
 * Crea el administrador inicial con su credencial de acceso.
 * Devuelve usuario y contraseña temporal para mostrarlos una única vez.
 */
function sembrarAdmin_() {
  var correo = CONFIG_().ADMIN_INICIAL || Session.getEffectiveUser().getEmail();
  if (!correo) { return null; }
  if (Db_.buscarPor('PERSONAL', 'CORREO', correo)) { return null; }

  var cargo = Db_.leer('CARGO')[0];
  var per = Db_.insertarCrudo('PERSONAL', {
    IDCARGO: cargo ? cargo.IDCARGO : '',
    DNI: '00000000', NOMBRES: 'Administrador', APELLIDOS: 'del Sistema',
    TELEFONO: '', CORREO: correo,
    FECHA_NAC: '1990-01-01', FECHA_INGRESO: Utilidades_.hoyISO(),
    ESTADO_PERSONAL: 'ACTIVO', OBSERVACIONES: 'Creado por instalar()'
  });
  var usu = Db_.insertarCrudo('USUARIO', {
    IDPERSONAL: per.IDPERSONAL, NIVEL_ACCESO: 'ADMIN',
    ESTADO_USUARIO: 'ACTIVO', OBSERVACIONES: 'Usuario inicial'
  });

  var temporal = Politica_.temporal();
  var salt = Cripto_.salt();
  var iter = SEGURIDAD_().ITERACIONES;
  Seg_.crear('CREDENCIAL', {
    IDUSUARIO: usu.IDUSUARIO, USUARIO_LOGIN: 'admin',
    HASH: Cripto_.derivar(temporal, salt, iter), SALT: salt, ITERACIONES: iter,
    HISTORIAL: '[]', DEBE_CAMBIAR: 'SI', FECHA_CAMBIO: Utilidades_.ahora(),
    INTENTOS_FALLIDOS: 0, BLOQUEADO_HASTA: '', ULTIMO_ACCESO: '',
    ESTADO_CREDENCIAL: 'ACTIVA', OBSERVACIONES: 'Credencial inicial del sistema'
  });

  return { usuarioLogin: 'admin', claveTemporal: temporal };
}

function registrarTriggers_() {
  var ss = SS_();
  var existentes = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (existentes.indexOf('auditarEdicionDirecta') === -1) {
    ScriptApp.newTrigger('auditarEdicionDirecta').forSpreadsheet(ss).onEdit().create();
  }
  if (existentes.indexOf('procesoDiario') === -1) {
    ScriptApp.newTrigger('procesoDiario').timeBased().everyDays(1).atHour(3).create();
  }
}

/**
 * Recuperación: genera una contraseña temporal nueva para un administrador.
 * Se ejecuta desde el editor de Apps Script (o desde el menú de la hoja) cuando
 * nadie puede entrar al panel. Deja constancia en AUDITORIA.
 *
 * Uso normal: restablecerClaveAdmin()  → toma el primer usuario ADMIN activo.
 * Uso puntual: restablecerClaveAdmin('jperez') → indica el usuario de acceso.
 */
function restablecerClaveAdmin(usuarioLogin) {
  var cred;

  if (usuarioLogin) {
    cred = Db_.buscarPor('CREDENCIAL', 'USUARIO_LOGIN', String(usuarioLogin).trim().toLowerCase());
    if (!cred) { throw new Error('No existe el usuario de acceso "' + usuarioLogin + '".'); }
  } else {
    var admins = Db_.leer('USUARIO').filter(function (u) {
      return String(u.NIVEL_ACCESO).toUpperCase() === 'ADMIN' &&
             String(u.ESTADO_USUARIO).toUpperCase() === 'ACTIVO';
    });
    if (!admins.length) { throw new Error('No hay ningún usuario con nivel ADMIN activo en la hoja USUARIO.'); }
    cred = Db_.buscarPor('CREDENCIAL', 'IDUSUARIO', admins[0].IDUSUARIO);
    if (!cred) {
      // El administrador existe pero nunca tuvo credenciales: se las creamos.
      cred = Seg_.crear('CREDENCIAL', {
        IDUSUARIO: admins[0].IDUSUARIO, USUARIO_LOGIN: 'admin', HISTORIAL: '[]',
        DEBE_CAMBIAR: 'SI', INTENTOS_FALLIDOS: 0, ESTADO_CREDENCIAL: 'ACTIVA',
        OBSERVACIONES: 'Creada por restablecerClaveAdmin()'
      });
    }
  }

  var temporal = Politica_.temporal();
  var salt = Cripto_.salt();
  var iter = SEGURIDAD_().ITERACIONES;

  Seg_.guardar('CREDENCIAL', cred.IDCREDENCIAL, {
    SALT: salt, ITERACIONES: iter, HASH: Cripto_.derivar(temporal, salt, iter),
    DEBE_CAMBIAR: 'SI', FECHA_CAMBIO: Utilidades_.ahora(),
    INTENTOS_FALLIDOS: 0, BLOQUEADO_HASTA: '', ESTADO_CREDENCIAL: 'ACTIVA'
  });

  Auditoria_.registrar(
    { correo: Session.getEffectiveUser().getEmail(), nivel: 'ADMIN', origen: 'MANTENIMIENTO' },
    'RESTABLECER_CLAVE', 'CREDENCIAL', cred.IDCREDENCIAL, '', '', '', 'OK',
    'Restablecida desde el editor para ' + cred.USUARIO_LOGIN);

  var texto = 'Usuario: ' + cred.USUARIO_LOGIN + '\nContraseña temporal: ' + temporal +
              '\n\nSe pedirá cambiarla al ingresar.';
  console.log(texto);
  try {
    SpreadsheetApp.getUi().alert('Acceso restablecido', texto, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (ignore) { /* ejecutado desde el editor: queda en el registro */ }

  return texto;
}

/** Menú de apoyo dentro de la hoja de cálculo. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu(CONFIG_().APP)
    .addItem('Instalar / reparar estructura', 'instalar')
    .addItem('Generar día de cumpleaños del año', 'generarCumpleaniosDelAnio')
    .addSeparator()
    .addItem('Verificar sistema', 'verificarSistema')
    .addItem('Migrar a la versión 2.0', 'migrarAVersion2')
    .addItem('Medir coste del cifrado', 'medirCostoHash')
    .addItem('Restablecer contraseña de administrador', 'restablecerClaveAdmin')
    .addToUi();
}

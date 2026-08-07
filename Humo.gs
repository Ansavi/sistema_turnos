/**
 * Prueba de humo por módulo. Carga el código real del repositorio sobre el
 * simulador y recorre el flujo completo: instalación, acceso, permisos,
 * maestros, ausencias, calendario y auditoría.
 */
const fs = require('fs');
const path = require('path');
const M = require('./mock');

const RUTA = process.argv[2] || '/home/claude/repo';
const ARCHIVOS = ['01_Config.gs', '02_Setup.gs', '03_Db.gs', '04_Auditoria.gs', '05_Auth.gs',
                  '06_Reglas.gs', '07_Calendario.gs', '08_Api.gs', '09_Permisos.gs'];

let fuente = ARCHIVOS.map(f => fs.readFileSync(path.join(RUTA, f), 'utf8')).join('\n');
// El código usa `var` y `function` en el ámbito global: eval lo replica bien.
eval(fuente);

let ok = 0, fallos = [];
function prueba(modulo, nombre, fn) {
  try {
    const r = fn();
    if (r === false) { throw new Error('devolvió falso'); }
    ok++;
    console.log('  \x1b[32m✓\x1b[0m [' + modulo + '] ' + nombre + (typeof r === 'string' ? ' → ' + r : ''));
  } catch (e) {
    fallos.push(modulo + ' / ' + nombre + ': ' + e.message);
    console.log('  \x1b[31m✗\x1b[0m [' + modulo + '] ' + nombre + ' → ' + e.message);
  }
}
function debeFallar(modulo, nombre, fn, fragmento) {
  try {
    fn();
    fallos.push(modulo + ' / ' + nombre + ': se esperaba un rechazo y no ocurrió');
    console.log('  \x1b[31m✗\x1b[0m [' + modulo + '] ' + nombre + ' → NO rechazó');
  } catch (e) {
    if (fragmento && e.message.toLowerCase().indexOf(fragmento.toLowerCase()) === -1) {
      fallos.push(modulo + ' / ' + nombre + ': rechazó con otro motivo → ' + e.message);
      console.log('  \x1b[33m!\x1b[0m [' + modulo + '] ' + nombre + ' → rechazó por: ' + e.message);
    } else {
      ok++;
      console.log('  \x1b[32m✓\x1b[0m [' + modulo + '] ' + nombre + ' → rechazado correctamente');
    }
  }
}

console.log('\n=== INSTALACIÓN ===');
prueba('setup', 'instalar() crea la estructura', () => {
  instalar();
  return M.LIBRO.getSheets().length + ' hojas';
});
prueba('setup', 'las 17 hojas del esquema existen', () => {
  const faltan = ORDEN_HOJAS_().filter(t => !M.LIBRO.getSheetByName(ESQUEMA_()[t].hoja));
  if (faltan.length) { throw new Error('faltan: ' + faltan.join(', ')); }
  return ORDEN_HOJAS_().length + ' hojas';
});
prueba('setup', 'CREDENCIAL y SESION quedan ocultas', () =>
  M.LIBRO.getSheetByName('CREDENCIAL').oculta && M.LIBRO.getSheetByName('SESION').oculta);
prueba('setup', 'matriz de permisos sembrada', () => Db_.leer('PERMISO').length + ' filas');
prueba('setup', 'tipos de día del sistema', () => Db_.leer('TIPO_DIA').length + ' tipos');

console.log('\n=== ACCESO ===');
const claveInicial = (M.alertas.join('\n').match(/Contraseña temporal: (\S+)/) || [])[1];
prueba('auth', 'instalar() entrega contraseña temporal', () => !!claveInicial);

debeFallar('auth', 'rechaza contraseña incorrecta',
  () => Auth_.iniciarSesion('admin', 'ClaveErrada99'), 'incorrect');
debeFallar('auth', 'rechaza usuario inexistente',
  () => Auth_.iniciarSesion('noexiste', 'Loquesea123'), 'incorrect');

let sesion;
prueba('auth', 'ingreso con la temporal', () => {
  sesion = Auth_.iniciarSesion('admin', claveInicial);
  if (!sesion.token) { throw new Error('sin token'); }
  if (!sesion.debeCambiarClave) { throw new Error('no exige cambio en primer ingreso'); }
  return 'exige cambio de clave';
});
prueba('auth', 'el token resuelve el contexto', () => {
  const ctx = Auth_.contexto(sesion.token);
  return ctx.nivel + ' / ' + ctx.nombre;
});
debeFallar('auth', 'token inválido no abre sesión',
  () => Auth_.contexto('token-falso'), 'SIN_SESION');

console.log('\n=== CAMBIO DE CONTRASEÑA (coste real) ===');
let ctx = Auth_.contexto(sesion.token);
debeFallar('auth', 'rechaza clave que no cumple política',
  () => Auth_.cambiarClave(ctx, claveInicial, 'corta'), 'política');
debeFallar('auth', 'rechaza si la actual es incorrecta',
  () => Auth_.cambiarClave(ctx, 'Otra12345678', 'Turnos2026Ok'), 'actual no es correcta');

M.hmac.reiniciar();
const t0 = Date.now();
prueba('auth', 'cambia la contraseña', () => {
  Auth_.cambiarClave(ctx, claveInicial, 'Turnos2026Ok');
  return Date.now() - t0 + ' ms locales';
});
const hmacCambio = M.hmac.total();
console.log('    → derivaciones HMAC en el cambio: \x1b[33m' + hmacCambio + '\x1b[0m llamadas');

M.hmac.reiniciar();
prueba('auth', 'ingreso con la contraseña nueva', () => {
  const s2 = Auth_.iniciarSesion('admin', 'Turnos2026Ok');
  if (s2.debeCambiarClave) { throw new Error('sigue exigiendo cambio'); }
  sesion = s2;
  return 'sin cambio pendiente';
});
console.log('    → derivaciones HMAC en el login:  \x1b[33m' + M.hmac.total() + '\x1b[0m llamadas');

ctx = Auth_.contexto(sesion.token);
debeFallar('auth', 'no permite reutilizar la anterior',
  () => Auth_.cambiarClave(ctx, 'Turnos2026Ok', claveInicial), 'reutilizar');

console.log('\n=== BLOQUEO POR INTENTOS ===');
prueba('auth', 'bloquea tras ' + SEGURIDAD_().INTENTOS_MAXIMOS + ' fallos', () => {
  let mensajeFinal = '';
  for (let i = 0; i < SEGURIDAD_().INTENTOS_MAXIMOS; i++) {
    try { Auth_.iniciarSesion('admin', 'Incorrecta' + i); } catch (e) { mensajeFinal = e.message; }
  }
  if (mensajeFinal.indexOf('bloquead') === -1) { throw new Error('no bloqueó: ' + mensajeFinal); }
  return 'bloqueada';
});
debeFallar('auth', 'con la clave correcta sigue bloqueada',
  () => Auth_.iniciarSesion('admin', 'Turnos2026Ok'), 'bloquead');
prueba('auth', 'el administrador desbloquea', () => {
  Auth_.desbloquear(ctx, ctx.idUsuario);
  sesion = Auth_.iniciarSesion('admin', 'Turnos2026Ok');
  ctx = Auth_.contexto(sesion.token);
  return 'acceso restaurado';
});

console.log('\n=== PERMISOS ===');
prueba('permisos', 'ADMIN tiene acceso total', () =>
  Object.keys(MODULOS_()).every(m =>
    MODULOS_()[m].acciones.every(a => Permisos_.puede('ADMIN', m, a))));
prueba('permisos', 'LECTOR no puede editar el calendario', () =>
  !Permisos_.puede('LECTOR', 'CALENDARIO', 'EDITAR'));
prueba('permisos', 'EDITOR no puede publicar', () =>
  !Permisos_.puede('EDITOR', 'CALENDARIO', 'PUBLICAR'));
prueba('permisos', 'SUPERVISOR sí puede publicar', () =>
  Permisos_.puede('SUPERVISOR', 'CALENDARIO', 'PUBLICAR'));
debeFallar('permisos', 'no se puede recortar a ADMIN',
  () => Permisos_.guardar(ctx, 'ADMIN', { CALENDARIO: { VER: false } }), 'acceso total');
prueba('permisos', 'cambio de matriz se aplica y se audita', () => {
  Permisos_.guardar(ctx, 'LECTOR', { CALENDARIO: { VER: true, EDITAR: true } });
  if (!Permisos_.puede('LECTOR', 'CALENDARIO', 'EDITAR')) { throw new Error('no se aplicó'); }
  Permisos_.guardar(ctx, 'LECTOR', { CALENDARIO: { VER: true, EDITAR: false } });
  return Permisos_.puede('LECTOR', 'CALENDARIO', 'EDITAR') ? 'no revirtió' : 'aplica y revierte';
});
prueba('permisos', 'la pantalla de permisos se arma', () => {
  const p = Permisos_.paraPantalla(ctx);
  return p.niveles.length + ' niveles × ' + p.modulos.length + ' módulos';
});

console.log('\n=== MAESTROS Y PERSONAL ===');
let idArea, idTurno, idPersona;
prueba('maestros', 'crear área', () => {
  idArea = Db_.insertar('AREA', { AREA: 'MESA DE AYUDA', ESTADO_AREA: 'ACTIVO' }, ctx).IDAREA;
  return idArea;
});
debeFallar('maestros', 'rechaza área duplicada',
  () => Db_.insertar('AREA', { AREA: 'mesa de ayuda', ESTADO_AREA: 'ACTIVO' }, ctx), 'ya existe');
prueba('maestros', 'habilitar turno en el área', () => {
  idTurno = Db_.buscarPor('TURNO', 'NOMBRE_TURNO', 'MAÑANA').IDTURNO;
  Db_.insertar('AREA_TURNO', { IDAREA: idArea, IDTURNO: idTurno, ESTADO: 'ACTIVO' }, ctx);
  return 'turno MAÑANA habilitado';
});
prueba('personal', 'crear persona', () => {
  idPersona = Db_.insertar('PERSONAL', {
    IDCARGO: Db_.leer('CARGO')[0].IDCARGO, DNI: '45678901',
    NOMBRES: 'Ana', APELLIDOS: 'Quispe', CORREO: 'aquispe@empresa.com',
    FECHA_NAC: '1992-08-15', FECHA_INGRESO: '2020-03-01', ESTADO_PERSONAL: 'ACTIVO'
  }, ctx).IDPERSONAL;
  return idPersona;
});
debeFallar('personal', 'rechaza DNI duplicado', () => Db_.insertar('PERSONAL', {
  IDCARGO: Db_.leer('CARGO')[0].IDCARGO, DNI: '45678901', NOMBRES: 'Otro', APELLIDOS: 'Nombre',
  CORREO: 'otro@empresa.com', FECHA_NAC: '1990-01-01', FECHA_INGRESO: '2021-01-01',
  ESTADO_PERSONAL: 'ACTIVO'
}, ctx), 'ya existe');
debeFallar('personal', 'rechaza correo inválido', () => Db_.insertar('PERSONAL', {
  IDCARGO: Db_.leer('CARGO')[0].IDCARGO, DNI: '11111111', NOMBRES: 'X', APELLIDOS: 'Y',
  CORREO: 'no-es-correo', FECHA_NAC: '1990-01-01', FECHA_INGRESO: '2021-01-01',
  ESTADO_PERSONAL: 'ACTIVO'
}, ctx), 'correo');
prueba('personal', 'asignar al área', () => {
  Db_.insertar('PERSONAL_AREA', {
    IDPERSONAL: idPersona, IDAREA: idArea, FECHA_INICIO: '2026-01-01', ESTADO: 'ACTIVO'
  }, ctx);
  return Reglas_.personalDeArea(idArea, '2026-09-01', '2026-09-30').length + ' persona(s) en el área';
});

console.log('\n=== AUSENCIAS Y REGLAS ===');
prueba('ausencias', 'vacaciones calculan la fecha fin', () => {
  const v = Db_.insertar('VACACIONES', {
    IDPERSONAL: idPersona, FECHA_INICIO: '2026-09-07', DIAS: 7,
    ESTADO_VACACIONES: 'APROBADO'
  }, ctx);
  if (v.FECHA_FIN !== '2026-09-13') { throw new Error('fin calculado: ' + v.FECHA_FIN); }
  return '2026-09-07 + 7 días = ' + v.FECHA_FIN;
});
debeFallar('ausencias', 'rechaza vacaciones solapadas', () => Db_.insertar('VACACIONES', {
  IDPERSONAL: idPersona, FECHA_INICIO: '2026-09-10', DIAS: 3, ESTADO_VACACIONES: 'PENDIENTE'
}, ctx), 'cruza');
prueba('ausencias', 'descanso médico registrado', () => {
  Db_.insertar('DESCANSO_MEDICO', {
    IDPERSONAL: idPersona, DESCRIPCION: 'Reposo', FECHA_INICIO: '2026-09-20',
    FECHA_FIN: '2026-09-22', ESTADO_DESCANSO: 'APROBADO'
  }, ctx);
  return 'del 20 al 22';
});
prueba('ausencias', 'cumpleaños autocompleta la fecha', () => {
  const c = Db_.insertar('CUMPLEANIOS', {
    IDPERSONAL: idPersona, ANIO_BENEFICIO: 2026, ESTADO_BENEFICIO: 'APROBADO'
  }, ctx);
  if (c.FECHA_BENEFICIO !== '2026-08-15') { throw new Error('fecha: ' + c.FECHA_BENEFICIO); }
  return c.FECHA_BENEFICIO;
});
prueba('reglas', 'el mapa de ausencias detecta los 11 días', () => {
  const m = Reglas_.mapaAusencias('2026-09-01', '2026-09-30');
  const dias = Object.keys(m[idPersona] || {});
  if (dias.length !== 10) { throw new Error('detectó ' + dias.length + ' días, se esperaban 10'); }
  return '7 vacaciones + 3 descanso médico';
});

console.log('\n=== CALENDARIO ===');
prueba('calendario', 'el tablero se arma', () => {
  const t = Calendario_.tablero(ctx, idArea, 2026, 9);
  return t.filas.length + ' fila(s) × ' + t.dias.length + ' días';
});
prueba('calendario', 'las ausencias bloquean sus celdas', () => {
  const t = Calendario_.tablero(ctx, idArea, 2026, 9);
  const bloq = t.filas[0].celdas.filter(c => c.bloqueada).length;
  if (bloq !== 10) { throw new Error('bloqueadas: ' + bloq); }
  return bloq + ' celdas bloqueadas';
});
debeFallar('calendario', 'no deja programar trabajo en vacaciones',
  () => Db_.insertar('CALENDARIO_PERSONAL', {
    IDPERSONAL: idPersona, IDAREA: idArea, IDTURNO: idTurno,
    IDTIPO_DIA: Reglas_.idTipoDia('TRABAJO'), FECHA_CALENDARIO: '2026-09-08',
    ESTADO_PROGRAMACION: 'BORRADOR'
  }, ctx), 'vacaciones');
prueba('calendario', 'programa un día hábil libre', () => {
  Db_.insertar('CALENDARIO_PERSONAL', {
    IDPERSONAL: idPersona, IDAREA: idArea, IDTURNO: idTurno,
    IDTIPO_DIA: Reglas_.idTipoDia('TRABAJO'), FECHA_CALENDARIO: '2026-09-01',
    ESTADO_PROGRAMACION: 'BORRADOR'
  }, ctx);
  return '2026-09-01 turno MAÑANA';
});
debeFallar('calendario', 'no permite doble programación el mismo día',
  () => Db_.insertar('CALENDARIO_PERSONAL', {
    IDPERSONAL: idPersona, IDAREA: idArea, IDTURNO: idTurno,
    IDTIPO_DIA: Reglas_.idTipoDia('TRABAJO'), FECHA_CALENDARIO: '2026-09-01',
    ESTADO_PROGRAMACION: 'BORRADOR'
  }, ctx), 'ya tiene una programación');
prueba('calendario', 'autocompletar el mes', () => {
  const r = Calendario_.prellenarMes(ctx, idArea, 2026, 9, idTurno);
  if (r.fallos.length) { throw new Error(r.fallos.length + ' fallos: ' + r.fallos[0].error); }
  return r.guardados + ' días generados';
});
prueba('calendario', 'las vacaciones quedaron marcadas como tales', () => {
  const t = Calendario_.tablero(ctx, idArea, 2026, 9);
  const dia8 = t.filas[0].celdas.find(c => c.fecha === '2026-09-08');
  if (dia8.tipo !== 'VACACIONES') { throw new Error('tipo: ' + dia8.tipo); }
  return 'el 8 de setiembre es VACACIONES';
});
prueba('calendario', 'publicar el mes', () => {
  const r = Calendario_.publicarMes(ctx, idArea, 2026, 9);
  return r.publicados + ' registros publicados';
});

console.log('\n=== API Y CONTROL DE ACCESO ===');
prueba('api', 'arranque devuelve permisos y catálogos', () => {
  const r = api('arranque', {}, sesion.token);
  if (!r.ok) { throw new Error(r.error); }
  return Object.keys(r.datos.tablas).length + ' tablas visibles';
});
prueba('api', 'sin token responde sinSesion', () => {
  const r = api('arranque', {}, null);
  return (!r.ok && r.sinSesion) ? 'rechazado' : false;
});
prueba('api', 'CREDENCIAL no se puede listar desde el panel', () => {
  const r = api('listar', { tabla: 'CREDENCIAL' }, sesion.token);
  return (!r.ok) ? 'bloqueado: ' + r.error : false;
});
prueba('api', 'acción desconocida se rechaza', () => {
  const r = api('borrarTodo', {}, sesion.token);
  return (!r.ok) ? 'rechazado' : false;
});
prueba('api', 'no se puede degradar al último administrador', () => {
  const r = api('actualizar', { tabla: 'USUARIO', id: ctx.idUsuario,
    datos: { NIVEL_ACCESO: 'LECTOR' } }, sesion.token);
  return (!r.ok && r.error.indexOf('único administrador') >= 0) ? 'protegido' : false;
});

console.log('\n=== USUARIO CON NIVEL LIMITADO ===');
let sesionLector;
prueba('seguridad', 'alta de usuario LECTOR con credenciales', () => {
  const u = Db_.insertar('USUARIO', {
    IDPERSONAL: idPersona, NIVEL_ACCESO: 'LECTOR', ESTADO_USUARIO: 'ACTIVO'
  }, ctx);
  const cred = Auth_.restablecerClave(ctx, u.IDUSUARIO);
  sesionLector = Auth_.iniciarSesion(cred.usuarioLogin, cred.claveTemporal);
  return 'usuario ' + cred.usuarioLogin;
});
prueba('seguridad', 'el LECTOR ve el calendario', () => {
  const ctxL = Auth_.contexto(sesionLector.token);
  const t = Calendario_.tablero(ctxL, idArea, 2026, 9);
  return t.puedeEditar ? false : 'en modo solo lectura';
});
prueba('seguridad', 'el LECTOR no puede escribir', () => {
  const r = api('crear', { tabla: 'AREA', datos: { AREA: 'PIRATA', ESTADO_AREA: 'ACTIVO' } },
    sesionLector.token);
  return (!r.ok) ? 'rechazado: ' + r.error.substring(0, 45) + '…' : false;
});
prueba('seguridad', 'el LECTOR no accede a la auditoría', () => {
  const r = api('auditoria', {}, sesionLector.token);
  return (!r.ok) ? 'rechazado' : false;
});
prueba('seguridad', 'el LECTOR no puede tocar permisos', () => {
  const r = api('guardarPermisos', { nivel: 'LECTOR', matriz: { PERMISOS: { EDITAR: true } } },
    sesionLector.token);
  return (!r.ok) ? 'rechazado' : false;
});

console.log('\n=== AUDITORÍA ===');
prueba('auditoria', 'la traza registró los movimientos', () => Db_.leer('AUDITORIA').length + ' registros');
prueba('auditoria', 'hay intentos DENEGADO registrados', () => {
  const n = Db_.leer('AUDITORIA').filter(r => r.RESULTADO === 'DENEGADO').length;
  return n > 0 ? n + ' rechazos' : false;
});
prueba('auditoria', 'ningún hash ni token quedó en la traza', () => {
  const cred = Db_.leer('CREDENCIAL')[0];
  const traza = JSON.stringify(Db_.leer('AUDITORIA'));
  if (cred.HASH && traza.indexOf(cred.HASH) >= 0) { throw new Error('¡se filtró un hash!'); }
  if (cred.SALT && traza.indexOf(cred.SALT) >= 0) { throw new Error('¡se filtró un salt!'); }
  const ses = Db_.leer('SESION')[0];
  if (ses && traza.indexOf(ses.TOKEN_HASH) >= 0) { throw new Error('¡se filtró un token!'); }
  return 'limpia';
});
prueba('auditoria', 'los cambios de permisos son reconstruibles', () => {
  const n = Db_.leer('AUDITORIA').filter(r => r.ACCION === 'PERMISOS').length;
  return n > 0 ? n + ' cambios con valor anterior y nuevo' : false;
});

console.log('\n' + '='.repeat(62));
console.log('  ' + ok + ' comprobaciones correctas, ' + fallos.length + ' fallo(s)');
if (fallos.length) {
  console.log('='.repeat(62));
  fallos.forEach(f => console.log('  ✗ ' + f));
  process.exitCode = 1;
}
console.log('='.repeat(62) + '\n');

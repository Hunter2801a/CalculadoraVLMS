(function () {
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var fmt = function (n) { return n.toLocaleString('en-US'); };
  var KEY = 'vlsm-calc-v1';

  var EX = {
    'Clase C': { net: '192.168.1.0/24', rows: [['Contabilidad', 60], ['Producción', 120], ['Informática', 10], ['Calidad', 24]], links: 4, eth: false },
    'Clase B': { net: '172.16.128.0/17', rows: [['Red 1', 3000], ['Red 2', 1500], ['Red 3', 5000], ['Red 4', 3000], ['Red 5', 4000], ['Red 6', 1500], ['Red 7', 250], ['Red 8', 600]], links: 8, eth: true },
    'Clase A': { net: '64.0.0.0/8', rows: [['Red 1', 1000000], ['Red 2', 2000000], ['Red 3', 4000000], ['Red 4', 3000000], ['Red 5', 500000]], links: 5, eth: false }
  };

  var state = { net: '', rows: [], links: 0, eth: false, example: '' };

  /* ---------- utilidades de red ---------- */
  function ipToInt(s) {
    var p = s.split('.'); if (p.length !== 4) return null;
    var n = 0;
    for (var i = 0; i < 4; i++) { if (!/^\d{1,3}$/.test(p[i])) return null; var v = +p[i]; if (v > 255) return null; n = n * 256 + v; }
    return n;
  }
  function intToIp(n) { return [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join('.'); }
  function maskOf(p) { return p === 0 ? 0 : ((0xFFFFFFFF << (32 - p)) >>> 0); }
  function maskToPrefix(m) { for (var p = 0; p <= 32; p++) if (maskOf(p) === m) return p; return null; }
  function ordinal(i) { return ['1.er', '2.º', '3.er', '4.º'][i]; }
  function letters(i) { var s = ''; i++; while (i > 0) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }

  function parseNet(str) {
    var m = str.trim().match(/^(\d+\.\d+\.\d+\.\d+)(?:\s*\/\s*(\d{1,2})|\s+(\d+\.\d+\.\d+\.\d+))?$/);
    var bad = function (t) { return { error: t }; };
    if (!m) return bad('Escribe la red así: 172.16.128.0/17 (también sirve 172.16.128.0 255.255.128.0).');
    var ip = ipToInt(m[1]);
    if (ip === null) return bad('La IP no es válida. Cada número va de 0 a 255.');
    var prefix, inferred = false;
    if (m[2] !== undefined) prefix = +m[2];
    else if (m[3]) {
      var mi = ipToInt(m[3]);
      if (mi === null) return bad('La máscara no es válida.');
      prefix = maskToPrefix(mi);
      if (prefix === null) return bad('La máscara no es continua (debe ser unos seguidos de ceros).');
    } else {
      var f = Math.floor(ip / 16777216);
      prefix = f < 128 ? 8 : f < 192 ? 16 : f < 224 ? 24 : null;
      if (prefix === null) return bad('Esa IP es de clase D o E. Escribe el prefijo, por ejemplo /24.');
      inferred = true;
    }
    if (prefix < 1 || prefix > 30) return bad('El prefijo debe estar entre /1 y /30.');
    var mask = maskOf(prefix);
    var base = (ip & mask) >>> 0;
    var f0 = Math.floor(base / 16777216);
    return { ip: ip, prefix: prefix, mask: mask, base: base, size: Math.pow(2, 32 - prefix), cls: f0 < 128 ? 'A' : f0 < 192 ? 'B' : f0 < 224 ? 'C' : '', changed: base !== ip, inferred: inferred };
  }
  function maskDec(p) { return intToIp(maskOf(p)); }
  function bin(prefix, basePrefix) {
    var o = '';
    for (var i = 0; i < 32; i++) {
      if (i && i % 8 === 0) o += '<i>.</i>';
      var c = i < prefix ? (i < basePrefix ? 'bb' : 'bs') : 'bz';
      o += '<span class="' + c + '">' + (i < prefix ? 1 : 0) + '</span>';
    }
    return '<span class="bin">' + o + '</span>';
  }
  function hostBits(need) { var m = 2; while (Math.pow(2, m) - 2 < need) m++; return m; }

  /* ---------- tablas ---------- */
  function cellHtml(c) {
    if (c && typeof c === 'object') return '<td class="' + (c.c || '') + '">' + c.v + '</td>';
    return '<td>' + c + '</td>';
  }
  function R(cells, cls) { return '<tr class="' + (cls || '') + '">' + cells.map(cellHtml).join('') + '</tr>'; }
  function T(head, rows, cls) {
    return '<div class="scroll"><table class="' + (cls || '') + '"><thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function step(n, title, body) { return '<section class="step"><h2><span class="n">' + n + '</span>' + title + '</h2>' + body + '</section>'; }
  var N = function (v) { return { c: 'num', v: v }; };
  var M = function (v) { return { c: 'mono nw', v: v }; };

  /* ---------- cálculo + render ---------- */
  var lastTSV = '';

  function compute() {
    var out = $('#out');
    var net = parseNet(state.net);
    if (net.error) { out.innerHTML = '<div class="msg bad">' + esc(net.error) + '</div>'; lastTSV = ''; return; }

    var problems = [];
    var items = [];
    state.rows.forEach(function (r, i) {
      var raw = String(r.hosts).replace(/[,\s]/g, '');
      if (raw === '') return;
      var name = (r.name && r.name.trim()) || ('Red ' + (i + 1));
      if (!/^\d+$/.test(raw) || +raw < 1) { problems.push('«' + esc(name) + '»: los hosts deben ser un entero mayor que 0.'); return; }
      var hosts = +raw;
      if (hosts > 2000000000) { problems.push('«' + esc(name) + '»: demasiados hosts.'); return; }
      items.push({ name: name, hosts: hosts, order: i });
    });
    var L = Math.max(0, Math.min(64, parseInt(state.links, 10) || 0));
    if (!items.length && !L) { out.innerHTML = '<div class="msg">Agrega al menos una red con su cantidad de hosts.</div>' + (problems.length ? '<div class="msg bad">' + problems.join('<br>') + '</div>' : ''); lastTSV = ''; return; }

    var eth = state.eth ? 1 : 0;
    items.forEach(function (it) {
      it.need = it.hosts + eth;
      it.m = hostBits(it.need);
      it.block = Math.pow(2, it.m);
      it.prefix = 32 - it.m;
      it.avail = it.block - 2;
      it.total = it.hosts + 2 + eth;
    });
    var sorted = items.slice().sort(function (a, b) { return b.need - a.need || a.order - b.order; });
    sorted.forEach(function (it, i) { it.n = i + 1; });
    var links = [];
    for (var k = 0; k < L; k++) links.push({ name: 'Enlace ' + letters(k), n: letters(k), hosts: 2, need: 2, m: 2, block: 4, prefix: 30, avail: 2, link: true });

    var all = sorted.concat(links);
    var sub1 = sorted.reduce(function (s, x) { return s + x.total; }, 0);
    var sub2 = L * 4;
    var grand = sub1 + sub2;

    // asignación secuencial
    var cursor = net.base, end = net.base + net.size, used = 0, over = [], missing = 0;
    all.forEach(function (it) {
      if (cursor + it.block > end) { it.over = true; over.push(it); missing += it.block; return; }
      it.net = cursor; it.first = cursor + 1; it.last = cursor + it.block - 2; it.bc = cursor + it.block - 1;
      cursor += it.block; used += it.block;
    });

    var h = '';

    // banner
    h += '<div class="banner"><b>' + intToIp(net.base) + '/' + net.prefix + '</b><span>máscara ' + maskDec(net.prefix) + '</span><span>' + fmt(net.size) + ' direcciones</span>' + (net.cls ? '<span>Clase ' + net.cls + '</span>' : '') + '</div>';
    if (net.changed) h += '<div class="msg warn">Escribiste ' + intToIp(net.ip) + ', que no es dirección de red para /' + net.prefix + '. Usé <b class="mono">' + intToIp(net.base) + '</b> como dirección de red.</div>';
    if (net.inferred) h += '<div class="msg warn">No indicaste prefijo. Usé /' + net.prefix + ' por ser clase ' + net.cls + '.</div>';
    if (problems.length) h += '<div class="msg bad">' + problems.join('<br>') + '<br>Esas filas se ignoraron.</div>';
    if (over.length) h += '<div class="msg bad"><b>No caben todas las subredes.</b> Sin espacio: ' + over.map(function (o) { return esc(o.name); }).join(', ') + '. Faltan ' + fmt(missing) + ' direcciones. Usa una red más grande (prefijo menor) o reduce hosts.</div>';

    // PASO 1
    var p1 = '<p>Ordena las cantidades de host de mayor a menor. Cada red también necesita su dirección de red y su broadcast' + (eth ? ' y una dirección para la interfaz Ethernet' : '') + '.</p>';
    var head1 = ['# de red', 'Nombre de la red', 'Host', 'IP Red', 'IP Broadcast'].concat(eth ? ['Ethernet'] : []).concat(['Total']);
    var rows1 = sorted.map(function (it) {
      return R([N(it.n), esc(it.name), N(fmt(it.hosts)), N(1), N(1)].concat(eth ? [N(1)] : []).concat([N(fmt(it.total))]));
    });
    rows1.push(R([{ c: 'num', v: '' }, 'Subtotal', '', '', ''].concat(eth ? [''] : []).concat([N(fmt(sub1))]), 'sum'));
    p1 += T(head1, rows1);
    if (L) {
      p1 += '<h3>Enlaces entre routers</h3>';
      var rows1b = links.map(function (l, i) { return R([N(i + 1), esc(l.name), N(4)]); });
      rows1b.push(R(['', 'Subtotal', N(fmt(sub2))], 'sum'));
      p1 += T(['# de enlace', 'Nombre del enlace', 'Direcciones para enlace'], rows1b);
    }
    p1 += '<p style="margin-top:.7rem" class="mono">' + fmt(sub1) + ' + ' + fmt(sub2) + ' = <b>' + fmt(grand) + '</b> direcciones</p>';
    h += step(1, 'Ordenar los hosts de mayor a menor', p1);

    // PASO 2
    var hb = 32 - net.prefix, cap = net.size, cumple = cap >= grand;
    var p2 = '<p>Comprueba que la red actual tenga espacio para todo lo pedido.</p><div class="calc">' +
      bin(net.prefix, net.prefix) + ' &nbsp;/' + net.prefix + '<br>' +
      '32 − ' + net.prefix + ' = <b>' + hb + '</b> bits de host<br>' +
      '2<sup>' + hb + '</sup> = ' + fmt(cap) + '<br>' +
      fmt(cap) + (cap > grand ? ' &gt; ' : cap === grand ? ' = ' : ' &lt; ') + fmt(grand) +
      '<span class="pill ' + (cumple ? 'ok' : 'no') + '">' + (cumple ? 'SÍ CUMPLE' : 'NO CUMPLE') + '</span></div>';
    p2 += '<p class="hint" style="margin-top:.5rem">Al redondear cada red a su bloque (potencia de 2) se ocupan ' + fmt(used) + ' de ' + fmt(cap) + ' direcciones (' + (used / cap * 100).toFixed(1) + '%).</p>';
    h += step(2, 'Comprobar que la red actual alcanza', p2);

    // PASO 3
    var p3 = '<p>Busca el exponente <b>m</b> más chico que cumpla <span class="fmla">2<sup>m</sup> − 2 ≥ hosts</span>. Se restan 2: una dirección para la red y otra para el broadcast.</p>';
    var rows3 = sorted.map(function (it) {
      var req = eth ? fmt(it.hosts) + ' + 1 = ' + fmt(it.need) : fmt(it.hosts);
      return R([esc(it.name), N(req), M('2<sup>' + it.m + '</sup> − 2 = ' + fmt(it.block) + ' − 2 = <b>' + fmt(it.avail) + '</b>'), N(it.m)]);
    });
    if (L) rows3.push(R(['Enlaces', N(2), M('2<sup>2</sup> − 2 = 4 − 2 = <b>2</b>'), N(2)], 'link'));
    p3 += T(['Red', 'Host', '2<sup>m</sup> − 2 = Host', 'm (bits de host)'], rows3);
    p3 += '<h3>Posición y valor de los bits</h3><div class="scroll bitstrip"><table><thead><tr>' + [7, 6, 5, 4, 3, 2, 1, 0].map(function (e) { return '<th>2<sup>' + e + '</sup></th>'; }).join('') + '</tr></thead><tbody><tr>' + [128, 64, 32, 16, 8, 4, 2, 1].map(function (v) { return '<td>' + v + '</td>'; }).join('') + '</tr></tbody></table></div>';
    h += step(3, 'Identificar los hosts de cada red', p3);

    // PASO 4
    var p4 = '<p>El prefijo es <span class="fmla">32 − m</span>. Cada bit encendido (1) pertenece a la red; los bits en 0 son para hosts.</p>';
    var rows4 = sorted.map(function (it) {
      return R([esc(it.name), N(fmt(it.hosts)), bin(it.prefix, net.prefix), M(maskDec(it.prefix)), M('<b>/' + it.prefix + '</b>')]);
    });
    if (L) rows4.push(R(['Enlaces', N(2), bin(30, net.prefix), M(maskDec(30)), M('<b>/30</b>')], 'link'));
    rows4.push(R(['<b>Máscara actual</b>', '', bin(net.prefix, net.prefix), M(maskDec(net.prefix)), M('<b>/' + net.prefix + '</b>')], 'sum'));
    p4 += T(['Red', 'Host', 'Nueva máscara (binario)', 'Decimal', 'Prefijo'], rows4);
    p4 += '<div class="legend"><span class="l1">bits de la red actual</span><span class="l2">bits nuevos de subred</span><span class="l3">bits de host</span></div>';
    h += step(4, 'Identificar la nueva máscara', p4);

    // PASO 5
    var p5 = '<p>El salto es <span class="fmla">256 − octeto modificado</span>. Dice de cuánto en cuánto avanza la dirección de red en ese octeto.</p>';
    function r5(name, prefix, cls) {
      var idx = Math.ceil(prefix / 8) - 1;
      var val = Math.floor(maskOf(prefix) / Math.pow(2, 24 - 8 * idx)) % 256;
      return R([esc(name), N(ordinal(idx) + ' octeto'), M('256 − ' + val + ' = <b>' + (256 - val) + '</b>'), M(maskDec(prefix)), M('/' + prefix)], cls);
    }
    var rows5 = sorted.map(function (it) { return r5(it.name, it.prefix); });
    if (L) rows5.push(r5('Enlaces', 30, 'link'));
    p5 += T(['Red', 'Octeto', '256 − octeto = salto', 'Nueva máscara', 'Prefijo'], rows5);
    h += step(5, 'Identificar el salto de red', p5);

    // RESULTADOS
    var rows6 = all.map(function (it) {
      if (it.over) return R([N(it.n), esc(it.name), N(fmt(it.hosts)), N(fmt(it.avail)), { c: 'mono', v: 'Sin espacio' }, M('/' + it.prefix), M(maskDec(it.prefix)), '', '', ''], 'over');
      return R([N(it.n), esc(it.name), N(fmt(it.hosts)), N(fmt(it.avail)), { c: 'mono nw net', v: intToIp(it.net) }, M('/' + it.prefix), M(maskDec(it.prefix)), M(intToIp(it.first)), M(intToIp(it.last)), { c: 'mono nw bc', v: intToIp(it.bc) }], it.link ? 'link' : '');
    });
    var tsvHead = ['N/SubRed', 'Nombre', 'Host solicitados', 'Host disponibles', 'Dirección de red', 'Prefijo', 'Máscara', 'Primera IP utilizable', 'Última IP utilizable', 'Broadcast'];
    lastTSV = [tsvHead.join('\t')].concat(all.map(function (it) {
      return [it.n, it.name, it.hosts, it.avail, it.over ? 'Sin espacio' : intToIp(it.net), '/' + it.prefix, maskDec(it.prefix), it.over ? '' : intToIp(it.first), it.over ? '' : intToIp(it.last), it.over ? '' : intToIp(it.bc)].join('\t');
    })).join('\n');

    h += '<section class="step"><div class="rtitle"><h2><span class="n">6</span>Resultados</h2><div><button type="button" id="copy">Copiar tabla</button> <span class="toast" id="toast"></span></div></div>' +
      '<div class="scroll"><table class="results"><thead><tr><th>N/Subred</th><th>Nombre</th><th>Host solicitados</th><th>Host disponibles</th><th>Dirección de red</th><th>Prefijo</th><th>Máscara</th><th>Primera IP</th><th>Última IP</th><th>Broadcast</th></tr></thead><tbody>' + rows6.join('') + '</tbody></table></div></section>';

    out.innerHTML = h;
    var cb = $('#copy');
    if (cb) cb.addEventListener('click', copyTSV);
  }

  function copyTSV() {
    var t = $('#toast');
    var say = function (m) { if (t) t.textContent = m; setTimeout(function () { if (t) t.textContent = ''; }, 2500); };
    var fallback = function () {
      try {
        var ta = document.createElement('textarea'); ta.value = lastTSV; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand('copy'); document.body.removeChild(ta);
        say(ok ? 'Copiada. Pégala en Excel o Word.' : 'No se pudo copiar. Selecciona la tabla a mano.');
      } catch (e) { say('No se pudo copiar. Selecciona la tabla a mano.'); }
    };
    try {
      navigator.clipboard.writeText(lastTSV).then(function () { say('Copiada. Pégala en Excel o Word.'); }, fallback);
    } catch (e) { fallback(); }
  }

  /* ---------- editor de filas ---------- */
  function renderRows(focusLast) {
    var box = $('#rows'); box.innerHTML = '';
    state.rows.forEach(function (r, i) {
      var d = document.createElement('div'); d.className = 'row';
      d.innerHTML = '<input type="text" id="rn' + i + '" aria-label="Nombre de la red ' + (i + 1) + '" placeholder="Red ' + (i + 1) + '">' +
        '<input type="text" id="rh' + i + '" inputmode="numeric" aria-label="Hosts de la red ' + (i + 1) + '" placeholder="hosts">' +
        '<button type="button" class="x" aria-label="Quitar red ' + (i + 1) + '">×</button>';
      var ni = d.children[0], hi = d.children[1], xb = d.children[2];
      ni.value = r.name; hi.value = r.hosts;
      ni.addEventListener('input', function () { r.name = ni.value; update(); });
      hi.addEventListener('input', function () { r.hosts = hi.value; update(); });
      hi.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addRow(); }
      });
      xb.addEventListener('click', function () { state.rows.splice(i, 1); renderRows(); update(); });
      box.appendChild(d);
    });
    if (focusLast) { var last = $('#rn' + (state.rows.length - 1)); if (last) last.focus(); }
  }
  function addRow() { state.rows.push({ name: '', hosts: '' }); renderRows(true); }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function update() { state.net = $('#net').value; state.links = $('#links').value; state.eth = $('#eth').checked; save(); compute(); }

  function load(ex, name) {
    state = { net: ex.net, rows: ex.rows.map(function (r) { return { name: r[0], hosts: String(r[1]) }; }), links: ex.links, eth: ex.eth, example: name || '' };
    $('#net').value = state.net; $('#links').value = state.links; $('#eth').checked = state.eth;
    renderRows(); save(); compute();
  }

  /* ---------- arranque ---------- */
  var ex = $('#examples');
  Object.keys(EX).forEach(function (k) {
    var b = document.createElement('button'); b.type = 'button'; b.textContent = k;
    b.addEventListener('click', function () { load(EX[k], k); });
    ex.appendChild(b);
  });
  $('#net').addEventListener('input', update);
  $('#links').addEventListener('input', update);
  $('#eth').addEventListener('change', update);
  $('#add').addEventListener('click', addRow);
  $('#f').addEventListener('submit', function (e) { e.preventDefault(); });

  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (saved && typeof saved.net === 'string' && Array.isArray(saved.rows)) {
    state = { net: saved.net, rows: saved.rows.map(function (r) { return { name: String(r.name || ''), hosts: String(r.hosts || '') }; }), links: saved.links || 0, eth: !!saved.eth, example: '' };
    $('#net').value = state.net; $('#links').value = state.links; $('#eth').checked = state.eth;
    renderRows(); compute();
  } else {
    load(EX['Clase C'], 'Clase C');
  }
})();

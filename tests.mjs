import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');
const code = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const Core = ctx.VacCore;

const D = (s) => Core.parse(s);
const plan = (o) => ({ year: 2027, days: 28, maxParts: 4, rule14: true, strict: false, window: null, pinned: [], blocked: [], regional: [], ...o });
const ctx27 = Core.context(plan({}));
const kindOf = (s) => ctx27.t(D(s));
const range = (a, b) => ({ from: D(a), to: D(b) });
const isoRange = (r) => [Core.iso(r.from), Core.iso(r.to)];

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok  ' + name);
}

// --- Производственный календарь ---

test('2027: 247 рабочих и 118 выходных и праздничных дней', () => {
  const m = Core.monthStats(2027);
  assert.equal(m.reduce((s, x) => s + x.work, 0), 247);
  assert.equal(m.reduce((s, x) => s + x.off, 0), 118);
});

test('2027: рабочие дни по месяцам совпадают с производственным календарём', () => {
  assert.deepEqual(Array.from(Core.monthStats(2027), (x) => x.work), [15, 19, 22, 22, 19, 21, 22, 22, 22, 21, 20, 22]);
});

test('2026: 247 рабочих дней', () => {
  assert.equal(Core.monthStats(2026).reduce((s, x) => s + x.work, 0), 247);
});

test('февраль 2027: суббота 20-го рабочая, 22-го перенесённый выходной, 23-го праздник', () => {
  assert.equal(kindOf('2027-02-20'), 'W');
  assert.equal(kindOf('2027-02-22'), 'O');
  assert.equal(kindOf('2027-02-23'), 'H');
  assert.equal(Core.mark(D('2027-02-20')), 'work');
  assert.equal(Core.mark(D('2027-02-22')), 'moved');
});

test('май 2027: 1 и 9 мая — праздники, 3 и 10 мая — перенесённые выходные', () => {
  assert.equal(kindOf('2027-05-01'), 'H');
  assert.equal(kindOf('2027-05-03'), 'O');
  assert.equal(kindOf('2027-05-09'), 'H');
  assert.equal(kindOf('2027-05-10'), 'O');
  assert.equal(kindOf('2027-05-04'), 'W');
});

test('перенесённые выходные: 14 июня, 5 ноября, 31 декабря 2027 и 31 декабря 2026', () => {
  for (const s of ['2027-06-14', '2027-11-05', '2027-12-31', '2026-12-31']) assert.equal(kindOf(s), 'O', s);
  assert.equal(kindOf('2026-12-30'), 'W');
});

test('1–8 января 2028 — праздники, 10 января 2028 — рабочий (переносы 2028 года неизвестны)', () => {
  for (let d = 1; d <= 8; d++) assert.equal(kindOf('2028-01-0' + d), 'H');
  assert.equal(kindOf('2028-01-09'), 'O');
  assert.equal(kindOf('2028-01-10'), 'W');
  assert.equal(Core.known(2028), false);
});

test('parse отбрасывает несуществующие даты', () => {
  assert.ok(Number.isNaN(D('2027-02-30')));
  assert.ok(Number.isNaN(D('27.02.2027')));
  assert.equal(Core.iso(D('2027-12-31')), '2027-12-31');
});

// --- Дни отпуска и отдых ---

test('праздник внутри отпуска не входит: 4–17 мая — 13 дней отпуска', () => {
  assert.equal(Core.count(ctx27, D('2027-05-04'), D('2027-05-17')), 13);
});

test('перенесённый выходной входит в отпуск: 10 мая — 1 день', () => {
  assert.equal(Core.count(ctx27, D('2027-05-10'), D('2027-05-10')), 1);
});

test('1–14 января 2027 — 6 дней отпуска', () => {
  assert.equal(Core.count(ctx27, D('2027-01-01'), D('2027-01-14')), 6);
});

test('4–7 мая дают отдых с 1 по 10 мая', () => {
  const s = Core.span(ctx27, D('2027-05-04'), D('2027-05-07'));
  assert.deepEqual(isoRange(s), ['2027-05-01', '2027-05-10']);
  assert.equal(s.len, 10);
});

test('11–24 января: отдых с 31 декабря 2026 по 24 января — 25 дней', () => {
  const s = Core.span(ctx27, D('2027-01-11'), D('2027-01-24'));
  assert.deepEqual(isoRange(s), ['2026-12-31', '2027-01-24']);
  assert.equal(s.len, 25);
});

test('27–30 декабря: отдых до 9 января 2028 — 16 дней', () => {
  const s = Core.span(ctx27, D('2027-12-27'), D('2027-12-30'));
  assert.deepEqual(isoRange(s), ['2027-12-25', '2028-01-09']);
});

test('две части через выходные сливаются в один блок отдыха', () => {
  const ev = Core.evaluate(ctx27, [range('2027-03-01', '2027-03-05'), range('2027-03-09', '2027-03-12')]);
  assert.equal(ev.blocks.length, 1);
  assert.deepEqual(isoRange(ev.blocks[0]), ['2027-02-27', '2027-03-14']);
  assert.equal(ev.rest, 16);
});

test('региональный праздник не входит в отпуск', () => {
  const c = Core.context(plan({ regional: ['2027-08-30'] }));
  assert.equal(c.t(D('2027-08-30')), 'H');
  assert.equal(Core.count(c, D('2027-08-30'), D('2027-09-05')), 6);
});

// --- Оптимизатор ---

function checkPlan(inp, r) {
  const c = Core.context(inp);
  const pins = (inp.pinned || []).map((p) => range(p.from, p.to));
  const isPin = (p) => pins.some((q) => q.from === p.from && q.to === p.to);
  assert.ok(r.parts.length <= inp.maxParts, 'частей больше лимита');
  let total = 0;
  r.parts.forEach((p, i) => {
    assert.ok(p.from >= c.from && p.to <= c.to, 'часть вне периода');
    if (i) assert.ok(p.from - r.parts[i - 1].to >= 2, 'части соприкасаются');
    assert.equal(p.days, Core.count(c, p.from, p.to));
    total += p.days;
    if (isPin(p)) return;
    assert.equal(c.t(p.from), 'W', 'часть начинается не в рабочий день');
    assert.notEqual(c.t(p.to), 'H', 'часть заканчивается праздником');
    for (let n = p.from; n <= p.to; n++) {
      assert.ok(!c.blocked(n), 'отпуск в недоступный день');
      assert.ok(!pins.some((q) => n >= q.from && n <= q.to), 'свободная часть залезла в закреплённую');
    }
    if (inp.strict) {
      let j = p.to + 1;
      while (c.t(j) === 'H') j++;
      assert.ok(c.t(j) === 'W' || j > c.to, 'строгий режим: выходные после части не вошли в отпуск');
    }
  });
  pins.forEach((q) => assert.ok(r.parts.some((p) => p.from === q.from && p.to === q.to), 'закреплённой части нет в плане'));
  assert.equal(total, r.used);
  assert.equal(r.score, Core.evaluate(c, r.parts).rest, 'счёт динамики не совпал с пересчётом');
  assert.equal(r.rest, r.score);
  if (r.need14 && !r.no14) {
    const wF = inp.window ? D(inp.window.from) : -Infinity, wT = inp.window ? D(inp.window.to) : Infinity;
    assert.ok(r.parts.some((p) => p.days >= 14 && p.from >= wF && p.to <= wT), 'нет части 14+ в окне');
  }
}

test('4 дня одной частью — лучше всего 27–30 декабря: 16 дней отдыха', () => {
  const r = Core.optimize(plan({ days: 4, maxParts: 1 }));
  assert.equal(r.parts.length, 1);
  assert.deepEqual([Core.iso(r.parts[0].from), Core.iso(r.parts[0].to)], ['2027-12-27', '2027-12-30']);
  assert.equal(r.rest, 16);
});

test('28 дней, 4 части: ровно 28 дней, есть часть 14+, счёт совпадает с пересчётом', () => {
  const inp = plan({});
  const r = Core.optimize(inp);
  assert.ok(r.ok);
  assert.equal(r.used, 28);
  assert.equal(r.no14, false);
  checkPlan(inp, r);
  assert.ok(r.rest >= 60, 'ожидали не меньше 60 дней отдыха, получили ' + r.rest);
});

test('без правила 14 дней отдыха не меньше, чем с ним', () => {
  const a = Core.optimize(plan({ rule14: true }));
  const b = Core.optimize(plan({ rule14: false }));
  checkPlan(plan({ rule14: false, maxParts: 4 }), b);
  assert.ok(b.rest >= a.rest);
});

test('длинная часть летом: 14+ дней внутри июня–августа', () => {
  const inp = plan({ window: { from: '2027-06-01', to: '2027-08-31' } });
  const r = Core.optimize(inp);
  assert.equal(r.no14, false);
  checkPlan(inp, r);
  assert.ok(r.parts.some((p) => p.long && p.from >= D('2027-06-01') && p.to <= D('2027-08-31')));
});

test('строгий режим: после частей нет выходных за рамками отпуска, отдыха не больше', () => {
  const inp = plan({ strict: true });
  const r = Core.optimize(inp);
  checkPlan(inp, r);
  assert.ok(r.rest <= Core.optimize(plan({})).rest);
});

test('закреплённая часть остаётся в плане и считается в лимит частей', () => {
  const inp = plan({ pinned: [{ from: '2027-07-05', to: '2027-07-18' }], maxParts: 2 });
  const r = Core.optimize(inp);
  checkPlan(inp, r);
  assert.equal(r.parts.length, 2);
  assert.ok(r.parts.some((p) => p.pinned && p.days === 14));
});

test('закреплённая часть может начинаться в выходной', () => {
  const inp = plan({ days: 10, rule14: false, maxParts: 2, pinned: [{ from: '2027-08-07', to: '2027-08-15' }] });
  const r = Core.optimize(inp);
  checkPlan(inp, r);
  assert.equal(r.used, 10);
});

test('недоступные дни не попадают в отпуск', () => {
  const inp = plan({ blocked: [{ from: '2027-12-01', to: '2027-12-31' }, { from: '2027-01-01', to: '2027-01-31' }] });
  const r = Core.optimize(inp);
  checkPlan(inp, r);
  assert.equal(r.used, 28);
});

test('период планирования: части только внутри него', () => {
  const inp = plan({ from: '2027-06-01', to: '2027-09-30', window: null });
  const r = Core.optimize(inp);
  checkPlan(inp, r);
});

test('ошибки ввода: пересекающиеся и лишние закреплённые части', () => {
  assert.equal(Core.optimize(plan({ pinned: [{ from: '2027-07-01', to: '2027-07-10' }, { from: '2027-07-11', to: '2027-07-20' }] })).reason, 'pinTouch');
  assert.equal(Core.optimize(plan({ days: 10, pinned: [{ from: '2027-07-01', to: '2027-07-20' }] })).reason, 'pinDays');
  assert.equal(Core.optimize(plan({ maxParts: 1, pinned: [{ from: '2027-03-01', to: '2027-03-02' }, { from: '2027-07-01', to: '2027-07-02' }] })).reason, 'pinParts');
  assert.equal(Core.optimize(plan({ pinned: [{ from: '2027-01-01', to: '2027-01-08' }] })).reason, 'pinEmpty');
  assert.equal(Core.optimize(plan({ from: '2027-06-01', to: '2027-06-30', pinned: [{ from: '2027-07-01', to: '2027-07-05' }] })).reason, 'pinOut');
});

test('если 14 дней подряд взять негде — план есть, но с пометкой', () => {
  const inp = plan({ window: { from: '2027-07-01', to: '2027-07-10' } });
  const r = Core.optimize(inp);
  assert.ok(r.ok);
  assert.equal(r.no14, true);
});

// --- Сверка с полным перебором ---

function brute(inp) {
  const c = Core.context(inp), F = c.from, T = c.to, t = (n) => c.t(n);
  const N = inp.days, K = inp.maxParts, need14 = inp.rule14 && N >= 14;
  const wF = inp.window ? D(inp.window.from) : -Infinity, wT = inp.window ? D(inp.window.to) : Infinity;
  const pins = inp.pinned.map((p) => range(p.from, p.to));
  const pinned = new Set();
  pins.forEach((p) => { for (let n = p.from; n <= p.to; n++) pinned.add(n); });
  const cnt = (s, e) => { let k = 0; for (let n = s; n <= e; n++) if (t(n) !== 'H') k++; return k; };
  const pinDays = pins.reduce((a, p) => a + cnt(p.from, p.to), 0);
  const tailOK = (n) => { let j = n + 1; while (t(j) === 'H') j++; return t(j) === 'W' || j > T; };
  const cands = [];
  for (let s = F; s <= T; s++) {
    if (t(s) !== 'W' || c.blocked(s) || pinned.has(s)) continue;
    for (let e = s; e <= T; e++) {
      if (c.blocked(e) || pinned.has(e)) break;
      const k = cnt(s, e);
      if (k > N - pinDays) break;
      if (t(e) === 'H' || (inp.strict && !tailOK(e))) continue;
      cands.push({ from: s, to: e, days: k });
    }
  }
  // Отдых считаем независимо: размечаем дни и собираем блоки
  const score = (parts) => {
    const vac = new Set();
    parts.forEach((p) => { for (let n = p.from; n <= p.to; n++) vac.add(n); });
    const off = (n) => vac.has(n) || t(n) !== 'W';
    const got = new Set();
    parts.forEach((p) => {
      let a = p.from, b = p.to;
      while (off(a - 1)) a--;
      while (off(b + 1)) b++;
      for (let n = a; n <= b; n++) got.add(n);
    });
    return got.size;
  };
  let best = -1;
  const rec = (i, chosen, used) => {
    if (used === N - pinDays) {
      const all = chosen.concat(pins).sort((a, b) => a.from - b.from);
      if (all.length > K) return;
      for (let j = 1; j < all.length; j++) if (all[j].from - all[j - 1].to < 2) return;
      if (need14 && !all.some((p) => cnt(p.from, p.to) >= 14 && p.from >= wF && p.to <= wT)) return;
      best = Math.max(best, score(all));
      return;
    }
    if (chosen.length + pins.length >= K) return;
    for (let j = i; j < cands.length; j++) {
      const p = cands[j];
      if (used + p.days > N - pinDays) continue;
      if (chosen.length && p.from - chosen[chosen.length - 1].to < 2) continue;
      chosen.push(p);
      rec(j + 1, chosen, used + p.days);
      chosen.pop();
    }
  };
  rec(0, [], 0);
  return best;
}

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

test('перебор: на 300 случайных задачах план не хуже полного перебора', () => {
  const R = rng(20271);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const int = (a, b) => a + Math.floor(R() * (b - a + 1));
  const anchors = ['2026-12-20', '2027-02-08', '2027-02-25', '2027-04-20', '2027-05-25', '2027-06-01', '2027-07-10', '2027-10-20', '2027-11-28'];
  let checked = 0, infeasible = 0;
  for (let it = 0; it < 300; it++) {
    const long = R() < 0.35;
    let from = Math.max(D('2027-01-01'), D(pick(anchors)) + int(0, 10));
    const len = long ? int(30, 45) : int(20, 40);
    let to = Math.min(D('2027-12-31'), from + len);
    const inp = plan({
      from: Core.iso(from), to: Core.iso(to),
      days: long ? int(14, 17) : int(1, 9),
      maxParts: long ? int(1, 3) : int(1, 3),
      rule14: long, strict: R() < 0.4,
      window: long && R() < 0.5 ? { from: Core.iso(from + int(0, 8)), to: Core.iso(to - int(0, 8)) } : null,
      blocked: R() < 0.4 ? [(() => { const a = from + int(0, len); return { from: Core.iso(a), to: Core.iso(a + int(0, 4)) }; })()] : [],
      regional: R() < 0.15 ? [Core.iso(from + int(0, len))] : []
    });
    if (R() < 0.25) {
      const a = from + int(0, len - 4);
      inp.pinned = [{ from: Core.iso(a), to: Core.iso(Math.min(to, a + int(0, 3))) }];
    }
    const r = Core.optimize(inp);
    const b = brute(inp);
    if (!r.ok) {
      assert.ok(['pinDays', 'pinEmpty', 'pinParts'].includes(r.reason) || b < 0, 'отказ при решаемой задаче: ' + r.reason + ' ' + JSON.stringify(inp));
      infeasible++;
      continue;
    }
    if (b < 0) {
      assert.ok(r.used < inp.days || r.no14, 'перебор не нашёл план, а динамика нашла: ' + JSON.stringify(inp));
      infeasible++;
      continue;
    }
    assert.equal(r.used, inp.days, 'не потрачены все дни: ' + JSON.stringify(inp));
    assert.equal(r.no14, false);
    checkPlan(inp, r);
    assert.equal(r.rest, b, 'хуже перебора: ' + JSON.stringify(inp));
    checked++;
  }
  assert.ok(checked > 150, 'мало решаемых задач: ' + checked);
  console.log('    решаемых задач: ' + checked + ', нерешаемых: ' + infeasible);
});

test('90 дней и 8 частей считаются быстрее 3 секунд', () => {
  const t0 = Date.now();
  const inp = plan({ days: 90, maxParts: 8, window: { from: '2027-06-01', to: '2027-08-31' } });
  const r = Core.optimize(inp);
  checkPlan(inp, r);
  assert.ok(Date.now() - t0 < 3000, 'долго: ' + (Date.now() - t0) + ' мс');
});

// --- Длинные выходные ---

test('длинные выходные 2027: 4–7 мая — мост между майскими, 27–30 декабря — 16 дней', () => {
  const runs = Core.bridges(plan({}));
  const opts = runs.flatMap((r) => r.options);
  const may = opts.find((o) => Core.iso(o.from) === '2027-05-04' && Core.iso(o.to) === '2027-05-07');
  assert.ok(may);
  assert.equal(may.side, 'bridge');
  assert.equal(may.rest.len, 10);
  const dec = opts.find((o) => Core.iso(o.from) === '2027-12-27');
  assert.equal(dec.rest.len, 16);
  const jan = opts.find((o) => Core.iso(o.from) === '2027-01-11');
  assert.deepEqual([Core.iso(jan.to), jan.rest.len], ['2027-01-15', 18]);
  assert.equal(runs.length, 8);
});

// --- Деньги ---

test('деньги: 1–5 марта при окладе 100 000 — отпускные 5/29,3 оклада, недоплата 5/22', () => {
  const m = Core.money(plan({}), [range('2027-03-01', '2027-03-05')], 100000);
  assert.ok(Math.abs(m.pay - 500000 / 29.3) < 0.01);
  assert.ok(Math.abs(m.lost - 500000 / 22) < 0.01);
});

test('деньги: праздник в отпуске не оплачивается, выходной оплачивается', () => {
  const m = Core.money(plan({}), [range('2027-05-04', '2027-05-10')], 29300);
  assert.ok(Math.abs(m.pay - 6000) < 0.01);
});

console.log('\n' + passed + ' тестов пройдено');

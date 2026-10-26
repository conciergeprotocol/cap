(function () {
  var source = document.getElementById('bench-data')
  if (!source) return
  var data = JSON.parse(source.textContent)
  var NS = 'http://www.w3.org/2000/svg'
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches

  var LABEL = {
    cap_ref: 'CAP',
    fetch_clean: 'Fetch, clean',
    fetch_real: 'Fetch, realistic',
    browser_real: 'Browser',
    fetch_heavy: 'Fetch',
    browser_heavy: 'Browser',
    'claude-opus-5-5': 'Opus 5.5',
    'claude-sonnet-5': 'Sonnet 5',
    'claude-haiku-4-5-20251001': 'Haiku 4.5'
  }
  var TONE = {
    cap_ref: 'cap',
    fetch_clean: 'clean',
    fetch_real: 'fetch',
    browser_real: 'browser',
    fetch_heavy: 'fetch',
    browser_heavy: 'browser',
    'claude-opus-5-5': 'opus',
    'claude-sonnet-5': 'sonnet',
    'claude-haiku-4-5-20251001': 'haiku'
  }
  var CATEGORY = { FP: 'One fact', MC: 'Multi-constraint', PR: 'Page vs record', LD: 'Local & delivery', CQ: 'Catalog query' }
  var MAIN = ['cap_ref', 'fetch_clean', 'fetch_real', 'browser_real']

  function usd(v) { return '$' + (v < 0.1 ? v.toFixed(3) : v.toFixed(2)) }
  function grouped(v) { return Math.round(v).toLocaleString('en-US') }
  function compact(v) { return v >= 1000 ? Math.round(v / 1000) + 'k' : String(Math.round(v)) }

  var METRICS = {
    cost: { tab: 'Cost', label: 'Cost per success', get: function (c) { return c.per_success }, fmt: usd, tick: function (v) { return '$' + v.toFixed(2) } },
    steps: { tab: 'Steps', label: 'Steps per run', get: function (c) { return c.steps }, fmt: function (v) { return v.toFixed(1) }, tick: function (v) { return String(+v.toFixed(1)) } },
    tokens: { tab: 'Tokens', label: 'Tokens per run', get: function (c) { return c.tokens }, fmt: grouped, tick: compact },
    time: { tab: 'Time', label: 'Seconds per run', get: function (c) { return c.wall_s }, fmt: function (v) { return v.toFixed(1) + ' s' }, tick: function (v) { return v + ' s' } },
    success: { tab: 'Success', label: 'Successes', get: function (c) { return c.ok }, fmt: function (v, c) { return c.ok + ' of ' + c.n }, tick: function (v) { return String(Math.round(v)) }, fixed: function (c) { return c.n } }
  }

  function el(name, attrs, parent) {
    var node = document.createElementNS(NS, name)
    for (var key in attrs) node.setAttribute(key, attrs[key])
    if (parent) parent.appendChild(node)
    return node
  }
  function html(tag, cls, parent, text) {
    var node = document.createElement(tag)
    if (cls) node.className = cls
    if (text != null) node.textContent = text
    if (parent) parent.appendChild(node)
    return node
  }

  function niceStep(span) {
    var raw = span / 4
    var mag = Math.pow(10, Math.floor(Math.log10(raw)))
    var steps = [1, 2, 2.5, 5, 10]
    for (var i = 0; i < steps.length; i++) if (steps[i] * mag >= raw) return steps[i] * mag
    return 10 * mag
  }
  function scaleFor(max, fixed) {
    if (fixed) return { max: fixed, step: fixed / 5 >= 5 ? Math.ceil(fixed / 5 / 5) * 5 : fixed / 3 }
    var step = niceStep(max)
    return { max: Math.ceil((max * 1.04) / step) * step, step: step }
  }

  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 }
  // Frames can be throttled in a background tab, so the end state also lands on a timer.
  function animate(ms, onFrame) {
    var start = performance.now(), landed = false
    function finish() { if (landed) return; landed = true; onFrame(1) }
    function step(now) {
      if (landed) return
      var t = Math.min(1, (now - start) / ms)
      if (t >= 1) return finish()
      onFrame(ease(t))
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
    setTimeout(finish, ms + 250)
  }

  function tween(from, to, draw, done) {
    if (still || !from) { draw(to); if (done) done(); return }
    function lerp(a, b, t) {
      if (typeof b === 'number') return (typeof a === 'number' ? a : b) + (b - (typeof a === 'number' ? a : b)) * t
      var out = {}
      for (var key in b) out[key] = lerp(a ? a[key] : undefined, b[key], t)
      return out
    }
    animate(420, function (t) {
      draw(t === 1 ? to : lerp(from, to, t))
      if (t === 1 && done) done()
    })
  }

  // Shared frame for every chart: title, metric tabs, legend, the svg, and a tooltip.
  function frame(fig, opts) {
    fig.classList.add('is-live')
    var head = html('div', 'bench-chart-head', fig)
    var titles = html('div', 'bench-chart-titles', head)
    var title = html('p', 'bench-chart-title', titles, opts.title)
    var sub = html('p', 'bench-chart-sub', titles, '')
    var tabs = html('div', 'bench-tabs', head)
    tabs.setAttribute('role', 'group')
    tabs.setAttribute('aria-label', 'Metric')
    var state = { metric: opts.metrics[0], on: {} }
    opts.series.forEach(function (s) { state.on[s] = true })
    opts.metrics.forEach(function (key) {
      var button = html('button', 'bench-tab', tabs, METRICS[key].tab)
      button.type = 'button'
      button.dataset.metric = key
      button.addEventListener('click', function () {
        state.metric = key
        sync()
        opts.update()
      })
    })
    var legend = html('div', 'bench-legend', fig)
    opts.series.forEach(function (s) {
      var button = html('button', 'bench-key tone-' + TONE[s], legend)
      button.type = 'button'
      button.dataset.series = s
      html('span', 'bench-swatch', button)
      html('span', '', button, opts.seriesLabel ? opts.seriesLabel(s) : LABEL[s])
      button.addEventListener('click', function () {
        var count = opts.series.filter(function (k) { return state.on[k] }).length
        if (state.on[s] && count === 1) return
        state.on[s] = !state.on[s]
        sync()
        opts.update()
      })
    })
    var svg = el('svg', { role: 'img', class: 'bench-svg' }, fig)
    var tip = html('div', 'bench-tip', fig)
    tip.hidden = true
    if (opts.note) html('figcaption', '', fig, opts.note)
    function sync() {
      tabs.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.metric === state.metric)) })
      legend.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(!!state.on[b.dataset.series])) })
      sub.textContent = METRICS[state.metric].label + (opts.subtitle ? ', ' + opts.subtitle : '')
      svg.setAttribute('aria-label', opts.title + '. ' + sub.textContent + '.')
    }
    sync()
    function show(event, content) {
      tip.innerHTML = content
      tip.hidden = false
      var box = fig.getBoundingClientRect()
      var x, y
      if (event.clientX != null && event.type.indexOf('pointer') === 0) {
        x = event.clientX - box.left
        y = event.clientY - box.top
      } else {
        var r = event.target.getBoundingClientRect()
        x = r.left + r.width / 2 - box.left
        y = r.top - box.top
      }
      var w = tip.offsetWidth
      tip.style.left = Math.max(4, Math.min(box.width - w - 4, x - w / 2)) + 'px'
      tip.style.top = Math.max(0, y - tip.offsetHeight - 14) + 'px'
    }
    function hide() { tip.hidden = true }
    fig.addEventListener('pointerleave', hide)
    return { svg: svg, state: state, show: show, hide: hide, title: title }
  }

  function detail(c) {
    return c.ok + ' of ' + c.n + ' succeeded · ' + usd(c.per_success) + ' per success · ' + c.steps.toFixed(1) + ' steps · ' + grouped(c.tokens) + ' tokens'
  }

  function axis(svg, layer, scale, box, metric) {
    while (layer.firstChild) layer.removeChild(layer.firstChild)
    var ticks = []
    for (var v = 0; v <= scale.max + 1e-9; v += scale.step) ticks.push(v)
    return ticks.map(function (v) {
      var line = el('line', { class: 'bench-grid', x1: box.left, x2: box.right }, layer)
      var text = el('text', { class: 'bench-tick', x: box.left - 8, 'text-anchor': 'end', dy: '0.32em' }, layer)
      text.textContent = metric.tick(v)
      return { v: v, line: line, text: text }
    })
  }
  function placeTicks(ticks, max, box) {
    ticks.forEach(function (t) {
      var y = box.bottom - (t.v / max) * (box.bottom - box.top)
      var visible = t.v <= max + 1e-9
      t.line.setAttribute('y1', y)
      t.line.setAttribute('y2', y)
      t.text.setAttribute('y', y)
      t.line.style.opacity = visible ? 1 : 0
      t.text.style.opacity = visible ? 1 : 0
    })
  }

  function wrapLabel(text, parent, x, y, narrow) {
    var node = el('text', { class: 'bench-label', x: x, y: y, 'text-anchor': 'middle' }, parent)
    var words = narrow ? text.split(' ') : [text]
    if (narrow && words.length > 2) words = [words[0], words.slice(1).join(' ')]
    words.forEach(function (word, i) {
      var span = el('tspan', { x: x, dy: i === 0 ? 0 : '1.15em' }, node)
      span.textContent = word
    })
  }

  // Grouped bars. cell(group, series) returns a result row, or null when the pair is not plotted.
  function bars(fig, opts) {
    var view, shown, ticks, rects = {}
    var ui = frame(fig, {
      title: opts.title, subtitle: opts.subtitle, note: opts.note, metrics: opts.metrics, series: opts.series, seriesLabel: opts.seriesLabel,
      update: function () { render(true) }
    })
    var gridLayer, barLayer, labelLayer, box

    function build() {
      var width = Math.max(300, fig.clientWidth)
      var narrow = width < 560
      var height = narrow ? 250 : 300
      box = { left: 52, right: width - 8, top: 12, bottom: height - (narrow ? 46 : 32) }
      ui.svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height)
      while (ui.svg.firstChild) ui.svg.removeChild(ui.svg.firstChild)
      gridLayer = el('g', {}, ui.svg)
      barLayer = el('g', {}, ui.svg)
      labelLayer = el('g', {}, ui.svg)
      rects = {}
      var gw = (box.right - box.left) / opts.groups.length
      opts.groups.forEach(function (g, gi) {
        wrapLabel(g.label, labelLayer, box.left + gw * gi + gw / 2, box.bottom + 18, narrow)
        opts.series.forEach(function (s) {
          var c = opts.cell(g.key, s)
          if (!c) return
          var rect = el('rect', { class: 'bench-bar tone-' + TONE[s], rx: 2, tabindex: 0 }, barLayer)
          var tipFor = function (event) {
            var m = METRICS[ui.state.metric]
            ui.show(event, '<strong>' + g.label + ' · ' + (opts.seriesLabel ? opts.seriesLabel(s) : LABEL[s]) + '</strong><span class="bench-tip-value">' + m.fmt(m.get(c), c) + '</span><span>' + detail(c) + '</span>')
          }
          rect.addEventListener('pointermove', tipFor)
          rect.addEventListener('pointerdown', tipFor)
          rect.addEventListener('focus', tipFor)
          rect.addEventListener('blur', ui.hide)
          rects[g.key + '|' + s] = { rect: rect, c: c, g: gi, s: s }
        })
      })
      el('line', { class: 'bench-baseline', x1: box.left, x2: box.right, y1: box.bottom, y2: box.bottom }, ui.svg)
    }

    function target() {
      var m = METRICS[ui.state.metric]
      var max = 0, fixed = 0, v = {}, w = {}
      Object.keys(rects).forEach(function (key) {
        var r = rects[key]
        var value = m.get(r.c)
        v[key] = value
        w[key] = ui.state.on[r.s] ? 1 : 0
        if (w[key]) max = Math.max(max, value)
        if (m.fixed) fixed = Math.max(fixed, m.fixed(r.c))
      })
      var scale = scaleFor(max, fixed)
      return { max: scale.max, step: scale.step, v: v, w: w }
    }

    function draw(frameState) {
      placeTicks(ticks, frameState.max, box)
      var gw = (box.right - box.left) / opts.groups.length
      var inner = gw * (opts.inner || 0.76)
      var totals = {}
      Object.keys(rects).forEach(function (key) { var r = rects[key]; totals[r.g] = (totals[r.g] || 0) + frameState.w[key] })
      var cursor = {}
      Object.keys(rects).forEach(function (key) {
        var r = rects[key]
        var total = totals[r.g] || 1
        var x0 = box.left + gw * r.g + (gw - inner) / 2
        var share = frameState.w[key] / total
        var bw = inner * share
        var x = x0 + (cursor[r.g] || 0)
        cursor[r.g] = (cursor[r.g] || 0) + bw
        var h = Math.max(0, (frameState.v[key] / frameState.max) * (box.bottom - box.top))
        r.rect.setAttribute('x', x + bw * 0.08)
        r.rect.setAttribute('width', Math.max(0, bw * 0.84))
        r.rect.setAttribute('y', box.bottom - h)
        r.rect.setAttribute('height', h)
        r.rect.style.opacity = frameState.w[key]
        r.rect.style.pointerEvents = frameState.w[key] > 0.5 ? 'auto' : 'none'
      })
    }

    function render(animate) {
      var next = target()
      ticks = axis(ui.svg, gridLayer, next, box, METRICS[ui.state.metric])
      tween(animate ? shown : null, next, draw)
      shown = next
    }

    build()
    render(false)
    entrance(fig, function () { shown = flatten(shown); draw(shown) }, function () { render(true) })
    onResize(fig, function () { build(); render(false) })
  }

  function flatten(state) {
    var out = { max: state.max, step: state.step, v: {}, w: state.w }
    Object.keys(state.v).forEach(function (k) { out.v[k] = 0 })
    return out
  }

  // Lines over catalog size, with one hover column per size.
  function lines(fig, opts) {
    var shown, ticks, box, gridLayer, lineLayer, pointLayer, hoverLayer, paths = {}, dots = {}
    var ui = frame(fig, {
      title: opts.title, subtitle: opts.subtitle, note: opts.note, metrics: opts.metrics, series: opts.series,
      update: function () { render(true) }
    })
    function build() {
      var width = Math.max(300, fig.clientWidth)
      var height = width < 560 ? 240 : 290
      box = { left: 52, right: width - 24, top: 14, bottom: height - 34 }
      ui.svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height)
      while (ui.svg.firstChild) ui.svg.removeChild(ui.svg.firstChild)
      gridLayer = el('g', {}, ui.svg)
      lineLayer = el('g', {}, ui.svg)
      pointLayer = el('g', {}, ui.svg)
      hoverLayer = el('g', {}, ui.svg)
      el('line', { class: 'bench-baseline', x1: box.left, x2: box.right, y1: box.bottom, y2: box.bottom }, ui.svg)
      paths = {}
      dots = {}
      opts.series.forEach(function (s) {
        paths[s] = el('polyline', { class: 'bench-line tone-' + TONE[s] }, lineLayer)
        dots[s] = opts.xs.map(function () { return el('circle', { class: 'bench-dot tone-' + TONE[s], r: 4.5 }, pointLayer) })
      })
      var span = (box.right - box.left) / (opts.xs.length - 1 || 1)
      opts.xs.forEach(function (x, i) {
        var cx = xAt(i)
        var label = el('text', { class: 'bench-label', x: cx, y: box.bottom + 20, 'text-anchor': i === 0 ? 'start' : i === opts.xs.length - 1 ? 'end' : 'middle' }, ui.svg)
        label.textContent = x.label
        var hit = el('rect', { class: 'bench-hit', x: cx - span / 2, width: span, y: box.top, height: box.bottom - box.top, tabindex: 0 }, hoverLayer)
        var tipFor = function (event) {
          var m = METRICS[ui.state.metric]
          var rows = opts.series.filter(function (s) { return ui.state.on[s] }).map(function (s) {
            var c = opts.cell(x.key, s)
            return '<span class="bench-tip-row"><i class="bench-swatch tone-' + TONE[s] + '"></i>' + LABEL[s] + ': <b>' + m.fmt(m.get(c), c) + '</b>, ' + c.ok + ' of ' + c.n + '</span>'
          })
          ui.show(event, '<strong>' + x.label + '</strong>' + rows.join(''))
        }
        hit.addEventListener('pointermove', tipFor)
        hit.addEventListener('pointerdown', tipFor)
        hit.addEventListener('focus', tipFor)
        hit.addEventListener('blur', ui.hide)
      })
    }
    function xAt(i) { return box.left + 10 + ((box.right - box.left - 20) * i) / (opts.xs.length - 1 || 1) }
    function target() {
      var m = METRICS[ui.state.metric]
      var max = 0, fixed = 0, v = {}, w = {}
      opts.series.forEach(function (s) {
        w[s] = ui.state.on[s] ? 1 : 0
        opts.xs.forEach(function (x, i) {
          var c = opts.cell(x.key, s)
          v[s + i] = m.get(c)
          if (w[s]) max = Math.max(max, v[s + i])
          if (m.fixed) fixed = m.fixed(c)
        })
      })
      var scale = scaleFor(max, fixed)
      return { max: scale.max, step: scale.step, v: v, w: w }
    }
    function draw(f) {
      placeTicks(ticks, f.max, box)
      opts.series.forEach(function (s) {
        var points = opts.xs.map(function (x, i) {
          var y = box.bottom - (f.v[s + i] / f.max) * (box.bottom - box.top)
          dots[s][i].setAttribute('cx', xAt(i))
          dots[s][i].setAttribute('cy', y)
          dots[s][i].style.opacity = f.w[s]
          return xAt(i) + ',' + y
        })
        paths[s].setAttribute('points', points.join(' '))
        paths[s].style.opacity = f.w[s]
      })
    }
    function render(animate) {
      var next = target()
      ticks = axis(ui.svg, gridLayer, next, box, METRICS[ui.state.metric])
      tween(animate ? shown : null, next, draw)
      shown = next
    }
    build()
    render(false)
    entrance(fig, function () { shown = flatten(shown); draw(shown) }, function () { render(true) })
    onResize(fig, function () { build(); render(false) })
  }

  // Everything starts drawn at its final values. Only a chart confirmed off screen is reset, then animated in when it is scrolled to.
  function entrance(node, reset, run) {
    if (still || !('IntersectionObserver' in window)) return
    var armed = false
    var seen = new IntersectionObserver(function (entries) {
      var entry = entries[0]
      if (!armed && !entry.isIntersecting) {
        armed = true
        reset()
        return
      }
      if (armed && entry.intersectionRatio >= 0.35) {
        seen.disconnect()
        run()
      }
    }, { threshold: [0, 0.35] })
    seen.observe(node)
  }
  function onResize(node, run) {
    if (!('ResizeObserver' in window)) return
    var last = node.clientWidth, timer
    new ResizeObserver(function () {
      if (Math.abs(node.clientWidth - last) < 8) return
      last = node.clientWidth
      clearTimeout(timer)
      timer = setTimeout(run, 120)
    }).observe(node)
  }

  function stats(node) {
    var cap = data.main.cap_ref, fetch = data.main.fetch_real, browser = data.main.browser_real
    var tiles = [
      { value: cap.per_success, fmt: usd, label: 'per right answer through CAP' },
      { value: Math.round((1 - cap.per_success / fetch.per_success) * 100), fmt: function (v) { return Math.round(v) + '%' }, label: 'less than fetching the site' },
      { value: Math.round((1 - cap.per_success / browser.per_success) * 100), fmt: function (v) { return Math.round(v) + '%' }, label: 'less than browsing it' },
      { value: cap.steps, fmt: function (v) { return v.toFixed(1) }, label: 'steps, against ' + Math.round(fetch.steps) + ' to ' + Math.round(browser.steps) + ' by reading' }
    ]
    var outs = tiles.map(function (tile) {
      var box = html('div', 'bench-stat', node)
      var out = html('p', 'bench-stat-value', box, tile.fmt(tile.value))
      html('p', 'bench-stat-label', box, tile.label)
      return out
    })
    entrance(node, function () {
      tiles.forEach(function (tile, i) { outs[i].textContent = tile.fmt(0) })
    }, function () {
      animate(900, function (t) {
        tiles.forEach(function (tile, i) { outs[i].textContent = tile.fmt(tile.value * t) })
      })
    })
  }

  function replay(node) {
    var spec = data.replay
    node.classList.add('is-live')
    var head = html('div', 'bench-chart-head', node)
    var titles = html('div', 'bench-chart-titles', head)
    html('p', 'bench-chart-title', titles, 'Task ' + spec.task_id)
    html('p', 'bench-chart-sub', titles, '“' + spec.prompt + '”')
    var play = html('button', 'bench-tab bench-play', head)
    play.type = 'button'
    var PLAY_ICON = '<path d="M7 4v16l13-8z"/>'
    var REPLAY_ICON = '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'
    function label(text, icon) {
      play.innerHTML = '<svg xmlns="' + NS + '" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icon + '</svg><span>' + text + '</span>'
    }
    label('Play', PLAY_ICON)
    var lanes = spec.runs.map(function (run) {
      var lane = html('div', 'bench-lane tone-' + TONE[run.condition], node)
      var top = html('div', 'bench-lane-head', lane)
      html('span', 'bench-lane-name', top, run.condition === 'cap_ref' ? 'Asked through CAP' : 'Browsed the realistic site')
      var count = html('span', 'bench-lane-count', top, '')
      var track = html('ol', 'bench-track', lane)
      var chips = run.steps.map(function (step) {
        var name = step.name.replace(/^(cap_|browser_)/, '').replace(/_/g, ' ')
        var chip = html('li', 'bench-step' + (step.name === 'submit_answer' ? ' is-answer' : ''), track, step.name === 'submit_answer' ? 'answer' : name)
        chip.title = step.name + (step.ms ? ', ' + step.ms + ' ms' : '')
        return chip
      })
      var result = html('p', 'bench-lane-result', lane, '')
      return { run: run, chips: chips, count: count, result: result }
    })
    html('figcaption', '', node, 'One tool call per beat, in the order the visitor made them. Totals count both sides. Both answers listed all ' + spec.matches + ' matching shoes.')
    var timer
    function finish(lane) {
      var run = lane.run
      lane.result.textContent = (run.success ? 'Correct' : 'Wrong') + ' · ' + run.items + ' of ' + spec.matches + ' found · ' + usd(run.usd) + ' · ' + grouped(run.tokens) + ' tokens · ' + run.wall_s + ' s'
      lane.result.classList.add('is-done')
    }
    function reset() {
      clearInterval(timer)
      lanes.forEach(function (lane) {
        lane.chips.forEach(function (chip) { chip.classList.remove('is-on') })
        lane.count.textContent = '0 steps'
        lane.result.textContent = ''
        lane.result.classList.remove('is-done')
      })
    }
    function showAll() {
      lanes.forEach(function (lane) {
        lane.chips.forEach(function (chip) { chip.classList.add('is-on') })
        lane.count.textContent = lane.chips.length + ' steps'
        finish(lane)
      })
    }
    function run() {
      reset()
      var beat = 0
      var longest = Math.max.apply(null, lanes.map(function (lane) { return lane.chips.length }))
      label('Replay', REPLAY_ICON)
      timer = setInterval(function () {
        lanes.forEach(function (lane) {
          if (beat < lane.chips.length) {
            lane.chips[beat].classList.add('is-on')
            lane.count.textContent = beat + 1 + ' steps'
            if (beat === lane.chips.length - 1) finish(lane)
          }
        })
        beat++
        if (beat >= longest) clearInterval(timer)
      }, 320)
    }
    play.addEventListener('click', function () { if (still) showAll(); else run() })
    showAll()
    entrance(node, reset, run)
  }

  var statsNode = document.querySelector('[data-stats]')
  if (statsNode) stats(statsNode)

  document.querySelectorAll('[data-chart]').forEach(function (fig) {
    var kind = fig.dataset.chart
    if (kind === 'category') {
      bars(fig, {
        title: 'By category, 30 runs each',
        metrics: ['cost', 'steps', 'tokens', 'time', 'success'],
        series: MAIN,
        groups: Object.keys(CATEGORY).map(function (key) { return { key: key, label: CATEGORY[key] } }),
        cell: function (g, s) { return data.category[g][s] },
        note: 'Hover or tap a bar for the full numbers. Click a legend entry to hide or show it.'
      })
    }
    if (kind === 'overall') {
      bars(fig, {
        title: 'All 50 tasks, 150 runs each',
        metrics: ['cost', 'tokens', 'steps', 'time', 'success'],
        series: MAIN,
        inner: 0.5,
        groups: MAIN.map(function (key) { return { key: key, label: LABEL[key] } }),
        cell: function (g, s) { return g === s ? data.main[s] : null }
      })
    }
    if (kind === 'scale') {
      lines(fig, {
        title: 'By catalog size, 9 runs a point',
        subtitle: 'heavier paginated pages',
        metrics: ['cost', 'tokens', 'steps', 'time'],
        series: ['cap_ref', 'fetch_heavy', 'browser_heavy'],
        xs: [{ key: '402', label: '402 styles' }, { key: '5000', label: '5,000 styles' }, { key: '50000', label: '50,000 styles' }],
        cell: function (x, s) { return data.scale[x][s] },
        note: 'Sizes are evenly spaced, not to scale. Every run at every size succeeded.'
      })
    }
    if (kind === 'models') {
      var models = ['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001']
      bars(fig, {
        title: 'By visitor model, the 10 pilot tasks, 30 runs each',
        metrics: ['cost', 'success', 'steps', 'tokens'],
        series: models,
        groups: ['cap_ref', 'fetch_real', 'browser_real'].map(function (key) { return { key: key, label: LABEL[key] } }),
        cell: function (g, s) { return data.weak[s][g] },
        note: 'Opus 5.5 numbers are its main-run results on the same ten tasks.'
      })
    }
  })

  var replayNode = document.querySelector('[data-replay]')
  if (replayNode) replay(replayNode)
})()

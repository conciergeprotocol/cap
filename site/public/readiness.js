(function () {
  var root = document.querySelector('[data-readiness]')
  if (!root) return
  var form = document.getElementById('readiness-form')
  var input = document.getElementById('domain')
  var status = document.getElementById('readiness-status')
  var bar = document.getElementById('readiness-bar')
  var button = form ? form.querySelector('button') : null
  var embedded = document.getElementById('readiness-result')
  var preset = domainFromLocation() || new URLSearchParams(location.search).get('domain') || ''
  if (preset && input) input.value = preset
  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault()
      score(input.value)
    })
  }
  if (embedded) {
    try {
      show(JSON.parse(embedded.textContent))
      return
    } catch (err) {
      // Fall through and score the domain.
    }
  }
  if (preset) score(preset)

  function score(domain) {
    setBusy(true, 'Scoring ' + domain + '. This can take up to a minute.')
    fetch('/api/readiness', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ domain: domain }),
    }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, body: body } })
    }).then(function (result) {
      setBusy(false, '')
      if (!result.ok) {
        status.textContent = (result.body && result.body.error && result.body.error.message) || 'The check could not run.'
        return
      }
      var next = '/readiness/' + encodeURIComponent(result.body.domain)
      if (location.pathname !== next) history.pushState(null, '', next)
      if (input) input.value = result.body.domain
      show(result.body)
    }).catch(function () {
      setBusy(false, 'The check could not run.')
    })
  }

  function setBusy(busy, message) {
    if (status) status.textContent = message
    if (button) button.disabled = busy
    if (bar) bar.hidden = !busy
  }

  function show(result) {
    root.replaceChildren()
    var hero = document.createElement('div')
    hero.className = 'readiness-hero'
    var max = result.blocked ? result.checkedMax : result.applicableMax
    hero.append(dial(result.score, max || 0))
    var summary = document.createElement('div')
    var number = document.createElement('p')
    number.className = 'readiness-number'
    number.textContent = result.blocked && !result.checkedMax ? 'Blocked' : String(result.score)
    var caption = document.createElement('p')
    caption.className = 'readiness-caption'
    if (result.blocked) caption.textContent = result.checkedMax ? 'Blocked, ' + result.score + ' of ' + result.checkedMax + ' checked' : 'Blocked before any check could finish'
    else if (result.applicableMax < 100) caption.textContent = 'of ' + result.applicableMax + ', because this site does not sell products'
    else caption.textContent = 'of 100'
    var host = document.createElement('p')
    host.className = 'readiness-host'
    host.textContent = result.domain
    summary.append(number, caption, host)
    hero.append(summary)
    root.append(hero)

    var list = document.createElement('ol')
    list.className = 'check-results'
    result.checks.forEach(function (check) { list.append(row(check)) })
    root.append(list)

    var share = document.createElement('p')
    var copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'readiness-copy'
    copy.textContent = 'Copy result link'
    copy.addEventListener('click', function () {
      var url = location.origin + '/readiness/' + encodeURIComponent(result.domain)
      var idle = copy.textContent
      writeText(url).then(function () {
        copy.textContent = 'Copied'
        setTimeout(function () { copy.textContent = idle }, 2000)
      })
    })
    share.append(copy)
    root.append(share)
    if (status) status.textContent = result.cached ? 'Cached result, less than 24 hours old.' : ''
  }

  function row(check) {
    var li = document.createElement('li')
    li.dataset.status = check.status
    var title = document.createElement('strong')
    title.textContent = check.title
    var state = document.createElement('span')
    state.className = 'check-state'
    state.textContent = label(check)
    var detail = document.createElement('p')
    detail.textContent = check.detail || ''
    li.append(title, state, detail)
    if (check.fix) {
      var fix = document.createElement('p')
      fix.className = 'readiness-fix'
      fix.textContent = 'How to fix: ' + check.fix
      li.append(fix)
    }
    ;(check.evidence || []).forEach(function (url) {
      if (!/^https:\/\//.test(url)) return
      var link = document.createElement('a')
      link.href = url
      link.textContent = url
      var line = document.createElement('p')
      line.append(link)
      li.append(line)
    })
    return li
  }

  function label(check) {
    if (check.status === 'pass' || check.status === 'partial') return check.points + ' of ' + check.max
    if (check.status === 'blocked') return 'Blocked'
    if (check.status === 'na') return 'Not applicable'
    return '0 of ' + check.max
  }

  function dial(score, max) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 120 120')
    svg.setAttribute('class', 'readiness-dial')
    svg.setAttribute('aria-hidden', 'true')
    var length = 2 * Math.PI * 52
    var fraction = max ? Math.max(0, Math.min(1, score / max)) : 0
    svg.append(circle(false, length, 0), circle(true, length, fraction * length))
    return svg
  }

  function circle(arc, length, dash) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    node.setAttribute('cx', '60')
    node.setAttribute('cy', '60')
    node.setAttribute('r', '52')
    node.setAttribute('fill', 'none')
    node.setAttribute('stroke-width', '8')
    node.setAttribute('stroke', arc ? 'var(--accent)' : 'var(--line)')
    if (arc) {
      node.setAttribute('stroke-linecap', 'round')
      node.setAttribute('stroke-dasharray', dash + ' ' + length)
      node.setAttribute('transform', 'rotate(-90 60 60)')
    }
    return node
  }

  function domainFromLocation() {
    var path = location.pathname.replace(/\/+$/, '')
    var at = path.indexOf('/readiness/')
    if (at === -1) return ''
    var rest = decodeURIComponent(path.slice(at + '/readiness/'.length))
    if (!rest || rest.indexOf('og/') === 0) return ''
    return rest
  }

  function writeText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text)
    return Promise.reject(new Error('copy'))
  }
})()

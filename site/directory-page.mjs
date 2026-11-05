import { ASK_EVERY_DAYS, DELIST_AFTER } from './doors.mjs'

// The icon the check found on the site, or the domain's first letter when there is none or it fails to load.
export const siteIconScript = `function siteIcon(domain, src) {
    var letter = document.createElement('span')
    letter.className = 'site-initial'
    letter.setAttribute('aria-hidden', 'true')
    letter.textContent = domain.charAt(0).toUpperCase()
    if (!src) return letter
    var img = document.createElement('img')
    img.className = 'site-icon'
    img.src = src
    img.alt = ''
    img.width = 24
    img.height = 24
    img.loading = 'lazy'
    img.referrerPolicy = 'no-referrer'
    img.addEventListener('error', function () { img.replaceWith(letter) })
    return img
  }`

export function directoryPageBody() {
  return `<h1>Companies with a CAP front door</h1>
<p>Every site here passed the <a href="/check">check</a>: it publishes <code>agent.txt</code>, answers a public question, and keeps each reply private to the agent that asked. A pass adds the site. Viewing this page or an entry rechecks it, at most once a day, and the question goes out once every ${ASK_EVERY_DAYS} days at most. A site that fails ${DELIST_AFTER} checks in a row drops off.</p>
<form class="check-form door-add">
<label for="domain">Add a website</label>
<input id="domain" name="domain" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="example.com" required>
<button type="submit">Add to directory</button>
</form>
<p class="check-status door-add-status" role="status"></p>
<p class="check-status door-status" role="status">Loading the directory.</p>
<ol class="door-list"></ol>
<script>
(function () {
  var list = document.querySelector('.door-list')
  var status = document.querySelector('.door-status')
  var addForm = document.querySelector('.door-add')
  var addStatus = document.querySelector('.door-add-status')
  var addButton = addForm.querySelector('button')
  ${siteIconScript}
  function when(iso) {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }
  function row(door) {
    var item = document.createElement('li')
    var icon = siteIcon(door.domain, door.icon)
    var link = document.createElement('a')
    link.href = '/check?domain=' + encodeURIComponent(door.domain)
    link.textContent = door.domain
    var since = document.createElement('span')
    since.textContent = 'Listed since ' + when(door.firstPassedAt) + (door.lastAnsweredAt ? '. Last answered ' + when(door.lastAnsweredAt) + '.' : '.')
    item.append(icon, link, since)
    return item
  }
  function load() {
    list.replaceChildren()
    status.textContent = 'Loading the directory.'
    return fetch('/api/doors').then(function (res) { return res.json() }).then(function (data) {
      var doors = (data && data.doors) || []
      if (!doors.length) {
        status.textContent = 'No doors are listed yet.'
        return
      }
      status.textContent = doors.length === 1 ? '1 site is listed.' : doors.length + ' sites are listed.'
      doors.forEach(function (door) { list.append(row(door)) })
    }).catch(function () {
      status.textContent = 'The directory could not load.'
    })
  }
  addForm.addEventListener('submit', function (event) {
    event.preventDefault()
    var domain = addForm.domain.value.trim()
    addButton.disabled = true
    addButton.textContent = 'Checking'
    addStatus.textContent = 'Checking ' + domain + '. This can take about 25 seconds. A pass adds the site.'
    fetch('/api/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: domain })
    }).then(function (res) { return res.json() }).then(function (data) {
      if (!data || data.error) {
        addStatus.textContent = (data && data.error && data.error.message) || 'The check could not run.'
        return
      }
      var name = data.domain || domain
      if (data.passed) {
        addStatus.textContent = name + ' passed and is listed.'
        addForm.reset()
        return load()
      }
      var failed = (data.checks || []).filter(function (check) { return !check.pass && !check.skipped })[0]
      addStatus.replaceChildren((failed && failed.detail) || (name + ' did not pass.') )
      addStatus.append(' ')
      var link = document.createElement('a')
      link.href = '/check?domain=' + encodeURIComponent(name)
      link.textContent = 'See the check'
      addStatus.append(link, '.')
    }).catch(function () {
      addStatus.textContent = 'The check could not run.'
    }).then(function () {
      addButton.disabled = false
      addButton.textContent = 'Add to directory'
    })
  })
  load()
})()
</script>`
}

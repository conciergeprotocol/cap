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
<p>Every site here passed the <a href="/check">check</a>: it publishes <code>agent.txt</code>, answers a public question, and keeps each reply private to the agent that asked. Entries are added by the check, not by hand. Viewing this page or an entry rechecks it, at most once a day, and the question goes out once every ${ASK_EVERY_DAYS} days at most. A site that fails ${DELIST_AFTER} checks in a row drops off.</p>
<p class="check-status door-status" role="status">Loading the directory.</p>
<ol class="door-list"></ol>
<script>
(function () {
  var list = document.querySelector('.door-list')
  var status = document.querySelector('.door-status')
  ${siteIconScript}
  function when(iso) {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }
  fetch('/api/doors').then(function (res) { return res.json() }).then(function (data) {
    var doors = (data && data.doors) || []
    if (!doors.length) {
      status.replaceChildren('No doors are listed yet. ')
      var first = document.createElement('a')
      first.href = '/check'
      first.textContent = 'Check yours'
      status.append(first, ' to be the first.')
      return
    }
    status.textContent = doors.length === 1 ? '1 site is listed.' : doors.length + ' sites are listed.'
    doors.forEach(function (door) {
      var item = document.createElement('li')
      var icon = siteIcon(door.domain, door.icon)
      var link = document.createElement('a')
      link.href = '/check?domain=' + encodeURIComponent(door.domain)
      link.textContent = door.domain
      var since = document.createElement('span')
      since.textContent = 'Listed since ' + when(door.firstPassedAt) + (door.lastAnsweredAt ? '. Last answered ' + when(door.lastAnsweredAt) + '.' : '.')
      item.append(icon, link, since)
      list.append(item)
    })
  }).catch(function () {
    status.textContent = 'The directory could not load.'
  })
})()
</script>`
}

// Dark mode: follows the system by default; the button toggles manually and remembers the choice in localStorage.
(function () {
  var KEY = 'theme';
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  } catch (e) {}

  function current() {
    var t = root.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.hidden = false;
    function sync() { btn.setAttribute('aria-pressed', String(current() === 'dark')); }
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
      sync();
    });
    sync();
  });
})();

// Demo 👍/👎 (DEMO_VOTES builds only): nothing is sent; the click shows a short note under the story.
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-demo-vote]');
  if (!b) return;
  var box = b.closest('.vote-demo');
  var meta = box.closest('.meta') || box;
  var note = meta.nextElementSibling && meta.nextElementSibling.classList.contains('vote-note') ? meta.nextElementSibling : null;
  if (!note) {
    note = document.createElement('p');
    note.className = 'vote-note';
    note.setAttribute('role', 'status');
    meta.insertAdjacentElement('afterend', note);
  }
  note.textContent = box.getAttribute('data-demo-msg');
  b.setAttribute('aria-pressed', 'true');
});

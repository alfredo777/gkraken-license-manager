document.addEventListener('DOMContentLoaded', () => {
  const menuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');
  if (menuBtn && sidebar) {
    menuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('hidden');
      sidebar.classList.toggle('fixed');
      sidebar.classList.toggle('inset-0');
      sidebar.classList.toggle('z-50');
    });
  }
  const currentPath = window.location.pathname;
  document.querySelectorAll('.sidebar-link').forEach(link => {
    if (link.getAttribute('href') === currentPath) link.classList.add('active');
  });
  document.querySelectorAll('[class*="bg-green-50"], [class*="bg-red-50"]').forEach(el => {
    setTimeout(() => { el.style.transition = 'opacity 0.5s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }, 5000);
  });
});
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    const t = document.createElement('div');
    t.className = 'fixed bottom-4 right-4 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm z-50';
    t.textContent = '¡Copiado!'; document.body.appendChild(t); setTimeout(() => t.remove(), 2000);
  });
}

// Auto-dismiss alerts after 5 seconds
document.addEventListener('DOMContentLoaded', function () {
  const alerts = document.querySelectorAll('.alert');
  alerts.forEach(alert => {
    setTimeout(() => {
      alert.style.transition = 'opacity .5s ease';
      alert.style.opacity = '0';
      setTimeout(() => alert.remove(), 500);
    }, 5000);
  });

  const navToggle = document.querySelector('.nav-toggle');
  const sidebar = document.querySelector('.sidebar');

  if (navToggle && sidebar) {
    const closeSidebar = () => {
      sidebar.classList.remove('is-open');
      document.body.classList.remove('sidebar-open');
      navToggle.setAttribute('aria-expanded', 'false');
    };

    const openSidebar = () => {
      sidebar.classList.add('is-open');
      document.body.classList.add('sidebar-open');
      navToggle.setAttribute('aria-expanded', 'true');
    };

    navToggle.addEventListener('click', () => {
      const isOpen = sidebar.classList.contains('is-open');
      if (isOpen) closeSidebar(); else openSidebar();
    });

    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        if (window.innerWidth <= 700) closeSidebar();
      });
    });

    document.addEventListener('click', (event) => {
      if (window.innerWidth > 700) return;
      const clickedInsideSidebar = sidebar.contains(event.target);
      const clickedToggle = navToggle.contains(event.target);
      if (!clickedInsideSidebar && !clickedToggle && sidebar.classList.contains('is-open')) {
        closeSidebar();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && sidebar.classList.contains('is-open')) {
        closeSidebar();
      }
    });
  }

  // Confirm before delete forms
  document.querySelectorAll('form[data-confirm]').forEach(form => {
    form.addEventListener('submit', function (e) {
      if (!confirm(this.dataset.confirm)) e.preventDefault();
    });
  });
});

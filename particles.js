// Ambient floating red particles behind page content.
// Disabled for users who prefer reduced motion.
(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.getElementById('bg-particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const COUNT = 38;
  let w, h, dpr, particles;

  const rand = (min, max) => Math.random() * (max - min) + min;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeParticle(atBottom) {
    return {
      x: rand(0, w),
      y: atBottom ? rand(0, h) : h + rand(0, h),
      r: rand(1, 3),
      vy: rand(-0.6, -0.25),   // drift upward
      vx: rand(-0.15, 0.15),   // gentle horizontal sway
      a: rand(0.15, 0.5)       // opacity
    };
  }

  function init() {
    resize();
    particles = Array.from({ length: COUNT }, () => makeParticle(true));
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;

      if (p.y < -12) { p.y = h + 12; p.x = rand(0, w); }
      if (p.x < -12) p.x = w + 12;
      if (p.x > w + 12) p.x = -12;

      const radius = p.r * 4;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      grad.addColorStop(0, 'rgba(255, 45, 45, ' + p.a + ')');
      grad.addColorStop(1, 'rgba(255, 45, 45, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }

  init();
  draw();
  window.addEventListener('resize', resize);
})();

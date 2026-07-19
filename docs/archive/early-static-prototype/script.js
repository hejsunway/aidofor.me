const header = document.querySelector('[data-header]');
const menuButton = document.querySelector('[data-menu-button]');
const mobileMenu = document.querySelector('[data-mobile-menu]');
const demoForm = document.querySelector('[data-demo-form]');
const demoInput = document.querySelector('[data-demo-input]');
const conversation = document.querySelector('[data-conversation]');
const characterCount = document.querySelector('[data-character-count]');

const closeMenu = () => {
  menuButton?.setAttribute('aria-expanded', 'false');
  mobileMenu?.classList.remove('open');
  document.body.classList.remove('menu-open');
};

menuButton?.addEventListener('click', () => {
  const opening = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(opening));
  mobileMenu.classList.toggle('open', opening);
  document.body.classList.toggle('menu-open', opening);
});

mobileMenu?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

const updateHeader = () => header?.classList.toggle('scrolled', window.scrollY > 20);
window.addEventListener('scroll', updateHeader, { passive: true });
updateHeader();

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach((item) => revealObserver.observe(item));

demoInput?.addEventListener('input', () => {
  characterCount.textContent = `${demoInput.value.length} / 280`;
});

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    demoInput.value = button.dataset.prompt;
    demoInput.dispatchEvent(new Event('input'));
    document.querySelector('#try-aido').scrollIntoView({ behavior: 'smooth' });
    window.setTimeout(() => demoInput.focus(), 500);
  });
});

const responses = [
  "Here’s a clean way forward: first decide what a good outcome looks like, then choose one small action you can finish today. Want me to turn that into a short plan?",
  "I can help shape that. The heart of it seems to be clarity without losing warmth. Let’s keep the message direct, add the context that matters, and end with one easy next step.",
  "Let’s make the trade-off visible. We can compare what each option gives you, what it costs, and which choice fits the season you’re in—not just the person you think you should be."
];

const addMessage = (text, type) => {
  const message = document.createElement('div');
  message.className = `message message-${type}`;
  message.textContent = text;
  conversation.append(message);
  conversation.scrollTop = conversation.scrollHeight;
  return message;
};

demoForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const thought = demoInput.value.trim();
  if (!thought) {
    demoInput.focus();
    return;
  }

  if (!conversation.querySelector('.message')) conversation.replaceChildren();
  addMessage(thought, 'user');
  demoInput.value = '';
  demoInput.dispatchEvent(new Event('input'));
  demoInput.disabled = true;

  const typing = document.createElement('div');
  typing.className = 'message message-aido typing';
  typing.setAttribute('aria-label', 'Aido is thinking');
  typing.innerHTML = '<i></i><i></i><i></i>';
  conversation.append(typing);
  conversation.scrollTop = conversation.scrollHeight;

  window.setTimeout(() => {
    typing.remove();
    const response = responses[Math.floor(Math.random() * responses.length)];
    addMessage(response, 'aido');
    demoInput.disabled = false;
    demoInput.focus();
  }, 900);
});

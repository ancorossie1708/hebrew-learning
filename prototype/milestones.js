/* Milestones use the same unique word stars as the topic and total counters. */
(function () {
  'use strict';
  let capacity = 100;
  let thresholds = [10,20,30,40,50,60,70,80,90,100];
  let activeDialog = null;
  let returnFocus = null;
  const halfway = () => Math.ceil(capacity / 20) * 10;
  const tier = count => count === capacity ? 'grand' : (count === halfway() || count === capacity-10) ? 'special' : 'standard';
  const icon = count => count === capacity ? '👑' : count === capacity-10 ? '💎' : count === halfway() ? '🏆' : '⭐';
  const title = count => count === capacity ? 'You did it!' : count === capacity-10 ? 'Almost there!' : count === halfway() ? 'Halfway there!' : 'Great progress!';
  function configure(wordCount) {
    if (!Number.isInteger(wordCount) || wordCount < 10 || wordCount % 10) throw new Error('Milestones require complete ten-word topics');
    capacity = wordCount;
    thresholds = Array.from({length:capacity/10},(_,index)=>(index+1)*10);
  }

  function markup(total) {
    return `<div class="milestone-track" aria-label="Star milestones">${thresholds.map(count =>
      `<span class="milestone-badge ${tier(count)} ${total >= count ? 'unlocked' : 'locked'}" role="img" aria-label="${count} stars: ${total >= count ? 'earned' : 'not yet earned'}"><span aria-hidden="true">${icon(count)}</span><strong>${count}</strong></span>`
    ).join('')}</div>`;
  }

  function dismiss() {
    if (!activeDialog) return;
    const dialog = activeDialog; activeDialog = null;
    QuizFeedback.clear();
    dialog.close(); dialog.remove();
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  function check(before, after, focusTarget) {
    const crossed = thresholds.filter(count => before < count && after >= count);
    if (!crossed.length) return false;
    const count = crossed.at(-1);
    dismiss();
    returnFocus = focusTarget || document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = `milestone-dialog ${tier(count)}`;
    dialog.setAttribute('aria-labelledby', 'milestone-title');
    dialog.setAttribute('aria-describedby', 'milestone-count');
    dialog.innerHTML = `<div class="milestone-medal" aria-hidden="true">${icon(count)}</div><h2 id="milestone-title">${title(count)}</h2><p id="milestone-count">${count} stars earned</p><p>${count === capacity ? `All ${capacity} words. What an achievement!` : count === capacity-10 ? `Just 10 more to reach ${capacity}!` : count === halfway() ? `${count} words, one amazing journey.` : 'One word at a time. Keep going!'}</p><button class="primary" autofocus>Keep learning</button>`;
    dialog.querySelector('button').addEventListener('click', dismiss);
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    document.body.appendChild(dialog);
    activeDialog = dialog;
    dialog.showModal();
    QuizFeedback.celebrate(tier(count), dialog, count);
    return true;
  }

  globalThis.addEventListener('pagehide', dismiss);
  globalThis.MilestoneRewards = {configure, markup, check, dismiss};
})();

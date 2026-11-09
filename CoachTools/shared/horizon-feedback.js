(function attachHorizonFeedback(root){
  'use strict';

  // Feedback configuration: replace only this empty value with the Microsoft
  // Forms response/embed URL when the form is ready. No external form is loaded
  // until the user opens Submit feedback.
  const FEEDBACK_FORM_URL = '';

  const FORM_HOSTS = new Set(['forms.office.com','forms.microsoft.com','forms.cloud.microsoft']);
  function configuredFormUrl(){
    if(!FEEDBACK_FORM_URL.trim())return '';
    try{
      const url=new URL(FEEDBACK_FORM_URL);
      return url.protocol==='https:'&&FORM_HOSTS.has(url.hostname.toLowerCase())&&!url.username&&!url.password?url.href:'';
    }catch(_){return '';}
  }
  const formUrl=configuredFormUrl();
  let dialog=null,frame=null,returnFocus=null;

  function placeholder(){
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Horizon feedback</title><style>*{box-sizing:border-box}html,body{height:100%;margin:0}body{display:grid;place-items:center;padding:28px;background:radial-gradient(ellipse at 70% 85%,#c3a26817,transparent 60%),linear-gradient(145deg,#10373a,#08282c);font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#fff0d3;text-align:center}.content{width:min(460px,100%)}.brand{width:min(270px,75%);height:auto;display:block;margin:0 auto 30px}.symbol{display:block;width:88px;height:88px;object-fit:contain;margin:0 auto 24px;filter:drop-shadow(0 5px 10px #00121544)}.eyebrow{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#d7bd8d;margin:0 0 12px}h1{font-size:clamp(23px,4vw,31px);font-weight:550;letter-spacing:-.025em;line-height:1.25;margin:0 0 14px}p{font-size:13px;line-height:1.7;color:#b9cfc5;margin:0}.note{margin-top:25px;color:#93aea5;font-size:11px}@media(max-width:460px){body{padding:22px}.brand{margin-bottom:22px}.symbol{margin-bottom:20px}p{font-size:12px}}</style></head><body><main class="content"><img class="brand" src="graphics/horizon-logo.png" alt="Horizon — MyOne 3.0"><img class="symbol" src="icons/horizon/submit-feedback.png" alt=""><p class="eyebrow">Your voice shapes Horizon</p><h1>Good ideas start with your feedback.</h1><p>The Microsoft feedback form will appear here.<br>We’re connecting the form so you can share ideas, report issues, and suggest improvements.</p><p class="note">Please check back soon.</p></main></body></html>`;
  }

  function restoreFocus(){
    if(returnFocus&&typeof returnFocus.focus==='function')returnFocus.focus();
    returnFocus=null;
  }
  function closeFeedback(){
    if(!dialog||!dialog.hasAttribute('open'))return;
    if(typeof dialog.close==='function')dialog.close();
    else{dialog.removeAttribute('open');restoreFocus();}
  }
  function createDialog(){
    dialog=document.createElement('dialog');
    dialog.id='horizonFeedbackDialog';dialog.className='horizon-feedback-dialog';
    dialog.setAttribute('aria-labelledby','horizonFeedbackTitle');
    dialog.setAttribute('aria-describedby','horizonFeedbackDescription');
    dialog.innerHTML='<header class="horizon-feedback-heading"><img src="icons/horizon/submit-feedback.png" alt="" width="48" height="48"><div><p>HELP SHAPE HORIZON</p><h2 id="horizonFeedbackTitle">Submit feedback</h2><p id="horizonFeedbackDescription" class="horizon-feedback-description">Share ideas, report issues, and help improve your coaching workspace.</p></div><button class="horizon-feedback-close" type="button" aria-label="Close feedback">×</button></header><footer class="horizon-feedback-footer"><p></p><a target="_blank" rel="noopener noreferrer">Open form in a new tab <span aria-hidden="true">↗</span></a></footer>';
    frame=document.createElement('iframe');frame.className='horizon-feedback-frame';
    frame.title='Horizon Microsoft feedback form';frame.setAttribute('referrerpolicy','strict-origin-when-cross-origin');
    const footer=dialog.querySelector('footer');dialog.insertBefore(frame,footer);
    const link=footer.querySelector('a');
    if(formUrl){
      frame.src=formUrl;link.href=formUrl;
      footer.querySelector('p').textContent='If the form doesn’t appear, open it in a new tab.';
    }else{
      frame.srcdoc=placeholder();link.hidden=true;
      footer.querySelector('p').textContent='The feedback form is coming soon.';
    }
    dialog.querySelector('.horizon-feedback-close').addEventListener('click',closeFeedback);
    dialog.addEventListener('close',restoreFocus);
    dialog.addEventListener('cancel',event=>{event.preventDefault();closeFeedback();});
    dialog.addEventListener('click',event=>{if(event.target===dialog)closeFeedback();});
    document.body.appendChild(dialog);
  }
  function openFeedback(trigger){
    returnFocus=trigger||document.activeElement;
    if(!dialog)createDialog();
    if(dialog.hasAttribute('open'))return;
    if(typeof dialog.showModal==='function')dialog.showModal();
    else{dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');}
    dialog.querySelector('.horizon-feedback-close').focus();
  }
  document.addEventListener('click',event=>{
    const trigger=event.target.closest&&event.target.closest('[data-horizon-feedback]');
    if(trigger)openFeedback(trigger);
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&dialog&&dialog.hasAttribute('open')){event.preventDefault();closeFeedback();}
  });
  root.HorizonFeedback=Object.freeze({open:openFeedback,close:closeFeedback,configured:Boolean(formUrl)});
})(window);

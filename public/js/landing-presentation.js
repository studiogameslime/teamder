/* Presentation only. Canonical navigation and store attribution stay in invite.html. */
(function(){
  'use strict';
  var $=function(id){return document.getElementById(id);};
  function icon(name){var s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('class','icon');s.setAttribute('aria-hidden','true');var u=document.createElementNS('http://www.w3.org/2000/svg','use');u.setAttribute('href','#'+name);s.appendChild(u);return s;}
  function text(el,value){if(el)el.textContent=value==null?'':String(value);}
  function safeImage(value){if(typeof value!=='string'||!value)return null;try{var u=new URL(value,location.origin);return u.protocol==='https:'||u.origin===location.origin?u.href:null;}catch(_){return null;}}
  function image(el,url){var clean=safeImage(url);if(!el)return;if(clean){el.src=clean;el.hidden=false;el.onerror=function(){el.hidden=true;};}else el.hidden=true;}
  function tag(label,name,free){if(!label)return;var el=document.createElement('span');el.className='tg'+(free?' free':'');el.appendChild(icon(name));var t=document.createElement('span');t.textContent=label;el.appendChild(t);$('ctxTags').appendChild(el);}
  function format(ms,options){try{return new Intl.DateTimeFormat('he-IL',Object.assign({timeZone:'Asia/Jerusalem'},options)).format(new Date(ms));}catch(_){return '';}}
  function finite(n){return typeof n==='number'&&Number.isFinite(n)&&n>=0;}
  function pill(value){if(!value)return;var el=document.createElement('span');el.className='pill';el.textContent=value;$('ctxPills').appendChild(el);}
  function inviter(d){var name=typeof d.inviterName==='string'?d.inviterName.trim():'';var box=$('inviter');box.classList.toggle('on',!!name);text($('ctxInviterName'),name?name+' הזמין אותך':'');image($('ctxInviterPortrait'),d.inviterPhotoUrl||d.inviterAvatarUrl);text($('inviterName'),name);image($('inviterPortrait'),d.inviterPhotoUrl||d.inviterAvatarUrl);$('inviterSummary').classList.toggle('on',!!name);var mobile=$('personalInviteCard');if(mobile){mobile.classList.toggle('on',!!name);text($('personalInviterName'),name);image($('personalInviterPortrait'),d.inviterPhotoUrl||d.inviterAvatarUrl);}}
  // A separate mobile invitation card keeps the real inviter readable over photography.
  var personalCard=document.createElement('article');personalCard.id='personalInviteCard';personalCard.className='personal-invite-card';personalCard.setAttribute('aria-label','הזמנה אישית');
  var personalIdentity=document.createElement('div');personalIdentity.className='personal-identity';var identityCopy=document.createElement('div');var inviteLabel=document.createElement('span');inviteLabel.className='invitation-label';inviteLabel.textContent='הזמנה אישית';var inviteName=document.createElement('h2');inviteName.id='personalInviterName';identityCopy.appendChild(inviteLabel);identityCopy.appendChild(inviteName);personalIdentity.appendChild(identityCopy);var portrait=document.createElement('img');portrait.id='personalInviterPortrait';portrait.alt='';portrait.hidden=true;personalIdentity.appendChild(portrait);personalCard.appendChild(personalIdentity);
  var personalAction=document.createElement('button');personalAction.type='button';personalAction.className='cta';personalAction.textContent='לפעילויות של המזמין';personalAction.addEventListener('click',function(){$('ctaBtn').click();});personalCard.appendChild(personalAction);$('personalCards').before(personalCard);
  function previewCard(title,subtitle,url,photo,kind){if(!title)return;var card=document.createElement('article');card.className='preview-card';var picture=document.createElement('img');picture.src=safeImage(photo)||'/landing/team.jpg';picture.alt='';picture.onerror=function(){picture.src='/landing/team.jpg';picture.onerror=null;};var copy=document.createElement('div');var h=document.createElement('h3');h.textContent=title;copy.appendChild(h);if(subtitle){var p=document.createElement('p');p.textContent=subtitle;copy.appendChild(p);}var a=document.createElement('a');a.className='link';var label=document.createElement('span');label.textContent=kind==='game'?'לפרטי המחזור':'לפרטי המועדון';var arrow=document.createElement('span');arrow.className='link-arrow';arrow.textContent='‹';arrow.setAttribute('aria-hidden','true');a.appendChild(label);a.appendChild(arrow);a.href=url;copy.appendChild(a);card.appendChild(copy);card.appendChild(picture);$('personalCards').appendChild(card);}
  window.updateLandingVariant=function(t){document.body.setAttribute('data-variant',t);var copy=t==='game'?['הרשמה מסודרת','חלוקת קבוצות','סיכום אישי']:t==='community'?['כל החברים במקום אחד','צ׳אט של המועדון','סטטיסטיקות ועונות']:['הרשמה למחזור','קבוצות ומועדונים','סטטיסטיקות מתקדמות'];copy.forEach(function(v,i){text($('benefit'+(i+1)),v);});text($('contextCta'),t==='community'?'לפרטי המועדון':'לפרטי המחזור');text($('ctxKind'),t==='community'?'הזמנה למועדון':'הזמנה למחזור');};
  window.renderLandingContext=function(d){
    $('contextLoading').classList.remove('on');if(!d||d.type==='generic')return;
    if(d.type==='personal'){inviter(d);var personalName=typeof d.inviterName==='string'?d.inviterName.trim():'';document.body.classList.toggle('personal-has-inviter',!!personalName);if(personalName.length>24)text($('title'),'הוזמנת לשחק\nעם החברים');$('personalCards').replaceChildren();var by=window.__INVITE__&&window.__INVITE__.invitedBy;var suffix=typeof window.getLandingShareQuery==='function'?window.getLandingShareQuery():(by?'?invitedBy='+encodeURIComponent(by):'');
      if(d.community&&typeof d.community.id==='string')previewCard(d.community.name,d.community.city,'/team/'+encodeURIComponent(d.community.id)+suffix,d.community.coverUrl,'community');
      if(d.nextGame&&typeof d.nextGame.id==='string')previewCard('המחזור הבא',format(d.nextGame.startsAt,{weekday:'long',hour:'2-digit',minute:'2-digit'}),'/session/'+encodeURIComponent(d.nextGame.id)+suffix,'/landing/ball.webp','game');return;}
    if(d.type!=='game'&&d.type!=='community')return;
    window.updateLandingVariant(d.type);$('ctxTags').replaceChildren();$('ctxPills').replaceChildren();inviter(d);
    if(d.type==='game'){
      text($('ctxTitle'),d.gameTitle||d.communityName||'מחזור כדורגל');
      var live=d.status==='active'||d.status==='live';
      var past=d.status==='finished'||d.status==='cancelled'||!live&&finite(d.startsAt)&&d.startsAt<Date.now();
      if(finite(d.startsAt)){tag(format(d.startsAt,{weekday:'long'})+' · '+format(d.startsAt,{hour:'2-digit',minute:'2-digit'}),'calendar');text($('title'),past?'הכדורגל ממשיך.\nזה הסיפור של המחזור.':format(d.startsAt,{weekday:'long'})+' נפגשים\nעל המגרש');}
      tag(d.fieldName||d.city,'pin');
      if(live){tag('המחזור מתקיים עכשיו','football');text($('title'),'הכדורגל קורה עכשיו.\nנפגשים על המגרש');}
      else if(past)tag(d.status==='cancelled'?'המחזור בוטל':d.status==='finished'?'המחזור הסתיים':'מועד המחזור עבר','calendar');
      else if(d.registrationClosed)tag(d.registrationOpensAt?'ההרשמה תיפתח '+format(d.registrationOpensAt,{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}):'ההרשמה סגורה כרגע','calendar');
      else if(finite(d.availableSpots))tag(d.availableSpots>0?'נשארו '+d.availableSpots+' מקומות':'המחזור מלא — אפשר לבדוק רשימת המתנה','people',true);
      var cap=finite(d.maxPlayers)&&d.maxPlayers>0&&finite(d.availableSpots);$('capacity').classList.toggle('on',cap);
      if(cap){var occ=Math.max(0,Math.min(d.maxPlayers,d.maxPlayers-d.availableSpots));text($('capacityText'),occ+'/'+d.maxPlayers);$('capacityProgress').setAttribute('aria-valuemin','0');$('capacityProgress').setAttribute('aria-valuemax',String(d.maxPlayers));$('capacityProgress').setAttribute('aria-valuenow',String(occ));requestAnimationFrame(function(){$('capacityFill').style.width=(occ/d.maxPlayers*100)+'%';});}
      if(d.format)pill(d.format);if(d.surface)pill(d.surface);if(typeof d.isPublic==='boolean')pill(d.isPublic?'פתוח לכולם':d.communityId?'סגור למועדון':'מחזור סגור');
    }else{
      text($('ctxTitle'),d.communityName||'מועדון כדורגל');tag(d.city,'pin');if(finite(d.communityMembersCount))tag(d.communityMembersCount+' שחקנים','people');$('capacity').classList.remove('on');
      $('clubThumb').src=safeImage(d.communityCover)||'/landing/team.jpg';$('clubThumb').onerror=function(){this.src='/landing/team.jpg';this.onerror=null;};
    }
    $('ctxCard').classList.add('on');
  };
  // Inline transport may have finished before this deferred script arrives.
  window.updateLandingVariant(document.body.getAttribute('data-variant')||window.__LANDING_VARIANT__||'generic');
  if(window.__LANDING_PREVIEW__)window.renderLandingContext(window.__LANDING_PREVIEW__);
  else if(['game','community','personal_invite'].indexOf(document.body.getAttribute('data-variant'))>=0&&!$('ctxCard').classList.contains('on'))$('contextLoading').classList.add('on');
  $('retryContext').addEventListener('click',function(){location.reload();});
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
  // CSS-only floating chips avoid layout work on scrolling. Reveal each section once.
  if('IntersectionObserver' in window&&!reduce.matches){var io=new IntersectionObserver(function(entries){entries.forEach(function(e){if(e.isIntersecting){if(!reduce.matches)e.target.animate([{opacity:.4,transform:'translateY(14px)'},{opacity:1,transform:'translateY(0)'}],{duration:550,easing:'ease-out'});io.unobserve(e.target);}});},{threshold:.18});document.querySelectorAll('.step').forEach(function(el){io.observe(el);});}
})();

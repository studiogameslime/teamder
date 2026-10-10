(function(){
  'use strict';
  var toc=document.getElementById('legal-contents');
  if(toc&&window.matchMedia('(min-width:960px)').matches)toc.open=true;
  if(!('IntersectionObserver' in window))return;
  var headings=document.querySelectorAll('.legal-content h2[id]');
  var links=toc?toc.querySelectorAll('a'):[];
  var observer=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){if(!entry.isIntersecting)return;links.forEach(function(link){if(link.hash==='#'+entry.target.id)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});});
  },{rootMargin:'-140px 0px -55% 0px',threshold:0});
  headings.forEach(function(heading){observer.observe(heading);});
})();

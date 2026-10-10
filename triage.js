// GramDoc triage rules.
// This is a simple screening aid, NOT a diagnosis. The limits below follow
// commonly used thresholds (BP, sugar, fever, oxygen). A doctor should review
// and change them before real use.
(function (root) {
  'use strict';
  var RANK = { normal: 0, soon: 1, urgent: 2, emergency: 3 };
  var SYMPTOMS = ['fever', 'cough', 'chest_pain', 'breathless', 'headache', 'weakness', 'vomiting', 'thirst', 'fainting'];

  function num(x) { return (typeof x === 'number' && isFinite(x)) ? x : null; }

  // p: { age, symptoms:[], vitals:{sbp,dbp,sugar,sugarType('fasting'|'random'),temp,spo2,pulse} }
  // returns { level, reasons:[{code, v}] }
  function assess(p) {
    var v = p.vitals || {};
    var sym = p.symptoms || [];
    var has = function (s) { return sym.indexOf(s) !== -1; };
    var age = num(p.age);
    var level = 'normal';
    var reasons = [];
    function add(lv, code, val) {
      reasons.push({ code: code, v: val === undefined ? '' : String(val) });
      if (RANK[lv] > RANK[level]) level = lv;
    }

    // symptoms
    if (has('chest_pain')) add('emergency', 'sym_chest');
    if (has('fainting')) add('emergency', 'sym_faint');
    if (has('breathless')) add('urgent', 'sym_breath');
    if (has('cough') && has('fever')) add('soon', 'sym_cough_fever');

    // oxygen
    var spo2 = num(v.spo2);
    if (spo2 !== null) {
      if (spo2 < 90) add('emergency', 'spo2_crit', spo2);
      else if (spo2 < 95) add('urgent', 'spo2_low', spo2);
    }

    // blood pressure
    var sbp = num(v.sbp), dbp = num(v.dbp);
    if (sbp !== null && dbp !== null) {
      var bp = sbp + '/' + dbp;
      var warn = has('chest_pain') || has('breathless') || has('headache') || has('weakness') || has('fainting');
      if (sbp >= 180 || dbp >= 120) add(warn ? 'emergency' : 'urgent', warn ? 'bp_crisis' : 'bp_veryhigh', bp);
      else if (sbp < 90 || dbp < 60) add('urgent', 'bp_low', bp);
      else if (sbp >= 140 || dbp >= 90) add('soon', 'bp_high', bp);
    }

    // sugar (mg/dL)
    var sug = num(v.sugar);
    if (sug !== null) {
      var fasting = v.sugarType === 'fasting';
      if (sug < 70) add('urgent', 'sugar_low', sug);
      else if (sug >= 300 && has('vomiting')) add('emergency', 'sugar_crisis', sug);
      else if (sug >= 300) add('urgent', 'sugar_veryhigh', sug);
      else if ((fasting && sug >= 126) || (!fasting && sug >= 200)) add('soon', 'sugar_high', sug);
    }

    // temperature (Celsius)
    var tmp = num(v.temp);
    if (tmp !== null) {
      var risky = age !== null && (age < 5 || age >= 65);
      if (tmp < 35) add('urgent', 'temp_low', tmp);
      else if (tmp >= 39.5) add('urgent', 'fever_high', tmp);
      else if (tmp >= 38 && risky) add('urgent', 'fever_risk', tmp);
      else if (tmp >= 38) add('soon', 'fever', tmp);
    }

    // pulse
    var pul = num(v.pulse);
    if (pul !== null) {
      if (pul > 120 || pul < 50) add('urgent', 'pulse_bad', pul);
      else if (pul > 100) add('soon', 'pulse_fast', pul);
    }

    // any symptom at all: at least talk to the doctor
    if (level === 'normal' && sym.length > 0) add('soon', 'sym_other');

    return { level: level, reasons: reasons };
  }

  // default follow-up (days) when the doctor does not set one
  function defaultFollowDays(level) {
    return { emergency: 1, urgent: 2, soon: 7, normal: 30 }[level];
  }

  var api = { assess: assess, defaultFollowDays: defaultFollowDays, SYMPTOMS: SYMPTOMS, RANK: RANK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Triage = api;
})(typeof self !== 'undefined' ? self : this);

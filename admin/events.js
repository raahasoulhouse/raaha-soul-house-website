/* RAAHA admin — Events & announcements.
   Confirmed event: needs a real date; shown as upcoming and hidden automatically after that date.
   Planned concept: shown as "dates to be announced". Never publish a date that isn't confirmed. */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$;

  function render() {
    var t = A.today();
    A.listEditor($('events-editor'), {
      collection: 'event',
      defaults: { title: '', tag: '', description: '', status: 'concept', date: '', time: '', location: '', show_from: '', visible: true },
      addLabel: 'Add event',
      title: function (v) { return v.title || '(new event)'; },
      note: function (v) {
        if (v.visible === false) return 'Hidden';
        if (v.status !== 'upcoming') return 'Planned concept';
        if (v.date && v.date < t) return 'Past — hidden automatically';
        if (v.show_from && v.show_from > t) return 'Scheduled — appears ' + A.fmtDate(v.show_from);
        return 'Confirmed · ' + A.fmtDate(v.date);
      },
      check: function (v) {
        if (v.status === 'upcoming' && !v.date) return 'A confirmed event needs its confirmed date. Use “Planned concept” until the date is set.';
        if (v.status !== 'upcoming' && v.date) return 'Planned concepts don’t show dates — clear the date or mark the event as confirmed.';
        return null;
      },
      fields: [
        { k: 'title', label: 'Title', required: true, max: 120 },
        { k: 'tag', label: 'Label (e.g. Wellness)', max: 40 },
        { k: 'status', label: 'Type', type: 'select', options: [['concept', 'Planned concept (no date shown)'], ['upcoming', 'Confirmed event (date shown)']] },
        { k: 'date', label: 'Confirmed date', type: 'date' },
        { k: 'time', label: 'Time (e.g. 7–9 PM)', max: 40 },
        { k: 'location', label: 'Location', max: 160 },
        { k: 'show_from', label: 'Announce from (optional)', type: 'date', help: 'Leave blank to show as soon as it is published.' },
        { k: 'description', label: 'Description', type: 'textarea', rows: 3, max: 600 },
        { k: 'media_id', label: 'Photo (confirmed events only)', type: 'photo', folder: 'events' },
        { k: 'visible', label: 'Show on website', type: 'check' }
      ]
    });
  }

  A.modules.push({ tab: 'events', onShow: render });
})();

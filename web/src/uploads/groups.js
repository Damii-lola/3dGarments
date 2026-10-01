/**
 * Garment photo upload (stage 1): an upload box, a review popup, and the groups it makes.
 *
 *   pick / drop images (up to 10 at a time) → the popup lists them: remove any, add more →
 *   Confirm → they become a group card. A card opens the same popup to edit its images, rename
 *   it or delete it; the trash icon deletes a whole group. Any number of groups.
 *
 * Groups are stored by store.js (Supabase when configured, else this browser). Everything the popup does works on a draft, so Cancel
 * (or Esc, or a click outside) leaves the group as it was.
 */
import { listGroups, saveGroup, deleteGroup, uid, MAX_PER_GROUP } from './store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = {
  upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
  shirt: '<svg viewBox="0 0 24 24"><path d="M8 3l-5 3 2 5 2-1v11h10V10l2 1 2-5-5-3c-.5 1.7-2 3-4 3s-3.5-1.3-4-3z"/></svg>',
};

/** object URLs for blobs, released when their image leaves the screen */
const urls = new WeakMap();
const urlOf = (img) => {
  if (!img.blob) return img.url || '';                    // a cloud image not downloaded: its signed URL
  if (!urls.has(img)) urls.set(img, URL.createObjectURL(img.blob));
  return urls.get(img);
};
const release = (img) => { const u = urls.get(img); if (u) { URL.revokeObjectURL(u); urls.delete(img); } };

/** keep image files only; decode-check so a broken or unsupported file (e.g. HEIC) is refused up front */
async function readFiles(files) {
  const ok = [], bad = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) { bad.push(f.name); continue; }
    try {
      const bmp = await createImageBitmap(f);
      bmp.close?.();
      ok.push({ id: uid(), name: f.name, type: f.type, blob: f });
    } catch { bad.push(f.name); }
  }
  return { ok, bad };
}

/**
 * @param toast (msg, type) — the app's toast
 * @param onWear (group) — "Try on" on a card: dress the model in it (the app does the work; setWearing marks the card)
 * @returns the section element (build once, keep it across panel rebuilds), with .setWearing(id | null)
 */
export function createUploads({ toast, onWear = null }) {
  let groups = [], wearing = null, working = null;
  const el = document.createElement('section');
  el.className = 'group uploads';
  el.innerHTML = `
    <h3>Garment photos<small>up to ${MAX_PER_GROUP} at a time</small></h3>
    <label class="dropzone" tabindex="0">
      <input type="file" accept="image/*" multiple hidden />
      <span class="dz-icon">${ICON.upload}</span>
      <span class="dz-text"><b>Upload photos</b><span>Drop images here or click to choose</span></span>
    </label>
    <div class="garment-groups"></div>`;
  const input = el.querySelector('input'), zone = el.querySelector('.dropzone'), list = el.querySelector('.garment-groups');

  const take = async (fileList) => {
    let files = [...fileList];
    if (!files.length) return;
    if (files.length > MAX_PER_GROUP) {
      toast(`Up to ${MAX_PER_GROUP} images at a time — the first ${MAX_PER_GROUP} were kept`, 'error');
      files = files.slice(0, MAX_PER_GROUP);
    }
    const { ok, bad } = await readFiles(files);
    if (bad.length) toast(`Skipped ${bad.length} file${bad.length > 1 ? 's' : ''} that ${bad.length > 1 ? "aren't images" : "isn't an image"} this browser can read`, 'error');
    if (ok.length) openEditor(null, ok);
  };
  input.addEventListener('change', () => { take(input.files); input.value = ''; });
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  for (const t of ['dragenter', 'dragover']) zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add('over'); });
  for (const t of ['dragleave', 'drop']) zone.addEventListener(t, () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); take(e.dataTransfer.files); });

  /** the card being worn / being dressed (the app tells us) */
  el.setWearing = (id, busyId = null) => { wearing = id; working = busyId; render(); };

  /* ---------------- group cards ---------------- */
  function render() {
    list.innerHTML = '';
    for (const g of groups) {
      const card = document.createElement('div');
      card.className = 'ggroup';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${g.name}, ${g.images.length} images — open to edit`);
      const shown = g.images.slice(0, 4), more = g.images.length - shown.length;
      card.innerHTML = `
        <div class="gg-thumbs">${shown.map((img, i) => `<span style="background-image:url('${urlOf(img)}')">${i === 3 && more > 0 ? `<b>+${more}</b>` : ''}</span>`).join('')}</div>
        <div class="gg-meta"><b>${esc(g.name)}</b><small>${g.images.length} image${g.images.length === 1 ? '' : 's'}</small></div>
        ${onWear ? `<button type="button" class="wear-btn${wearing === g.id ? ' on' : ''}${working === g.id ? ' busy' : ''}" data-act="wear"
          aria-label="${wearing === g.id ? 'Take off' : 'Try on'} ${esc(g.name)}">${ICON.shirt}<span>${working === g.id ? 'Dressing…' : wearing === g.id ? 'Take off' : 'Try on'}</span></button>` : ''}
        ${onWear ? '' : `<button type="button" class="icon-btn" data-act="edit" title="Edit group" aria-label="Edit ${esc(g.name)}">${ICON.edit}</button>`}
        <button type="button" class="icon-btn danger" data-act="delete" title="Delete group" aria-label="Delete ${esc(g.name)}">${ICON.trash}</button>`;
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-act="delete"]')) { askDelete(g); return; }
        if (e.target.closest('[data-act="wear"]')) { if (!working) onWear(g); return; }
        openEditor(g);
      });
      card.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); openEditor(g); } });
      list.append(card);
    }
  }

  async function askDelete(g) {
    if (!(await confirmBox(`Delete “${g.name}”?`, `Its ${g.images.length} image${g.images.length === 1 ? '' : 's'} will be removed.`, 'Delete group'))) return false;
    try { await deleteGroup(g); } catch (err) { toast(`Couldn't delete the group: ${err.message || err}`, 'error'); return false; }
    g.images.forEach(release);
    groups = groups.filter((x) => x.id !== g.id);
    render();
    toast(`Deleted ${g.name}`, 'success');
    return true;
  }

  /* ---------------- the popup ---------------- */
  /** @param group existing group to edit, or null for a new one; @param fresh images just picked */
  function openEditor(group, fresh = []) {
    const draft = { name: group?.name || nextName(), images: [...(group?.images || []), ...fresh] };
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <form method="dialog" class="modal-card">
        <header class="modal-head">
          <input class="modal-title" maxlength="40" aria-label="Group name" value="${esc(draft.name)}" />
          <span class="modal-count"></span>
          <button type="button" class="icon-btn" data-act="close" aria-label="Close">${ICON.x}</button>
        </header>
        <div class="modal-body"><div class="pick-grid"></div><p class="modal-hint"></p></div>
        <footer class="modal-foot">
          ${group ? `<button type="button" class="btn btn-danger" data-act="delete-group">${ICON.trash}<span>Delete group</span></button>` : '<span></span>'}
          <span class="grow"></span>
          <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
          <button type="button" class="btn btn-primary" data-act="confirm">Confirm</button>
        </footer>
        <input type="file" accept="image/*" multiple hidden />
      </form>`;
    document.body.append(dlg);
    const grid = dlg.querySelector('.pick-grid'), count = dlg.querySelector('.modal-count'), hint = dlg.querySelector('.modal-hint');
    const title = dlg.querySelector('.modal-title'), more = dlg.querySelector('input[type=file]'), confirmBtn = dlg.querySelector('[data-act="confirm"]');
    const removed = [];

    const paint = () => {
      const n = draft.images.length, full = n >= MAX_PER_GROUP;
      count.textContent = `${n} / ${MAX_PER_GROUP}`;
      count.classList.toggle('full', full);
      grid.innerHTML = draft.images.map((img, i) => `
        <figure class="pick" title="${esc(img.name)}">
          <img src="${urlOf(img)}" alt="${esc(img.name)}" draggable="false" />
          <button type="button" class="pick-x" data-i="${i}" aria-label="Remove ${esc(img.name)}">${ICON.x}</button>
        </figure>`).join('')
        + (full ? '' : `<button type="button" class="pick-add" data-act="add">${ICON.plus}<span>Add more</span><small>${MAX_PER_GROUP - n} left</small></button>`);
      hint.textContent = n ? (full ? `That's the maximum of ${MAX_PER_GROUP} images for a group.` : '') : 'No images left — add some, or cancel.';
      confirmBtn.disabled = !n;
    };
    paint();

    const addFiles = async (fileList) => {
      const room = MAX_PER_GROUP - draft.images.length;
      let files = [...fileList];
      if (!files.length) return;
      if (files.length > room) { toast(`Only ${room} more fit in this group — the first ${room} were added`, 'error'); files = files.slice(0, room); }
      const { ok, bad } = await readFiles(files);
      if (bad.length) toast(`Skipped ${bad.length} file${bad.length > 1 ? 's' : ''} that couldn't be read as an image`, 'error');
      draft.images.push(...ok);
      paint();
    };
    more.addEventListener('change', () => { addFiles(more.files); more.value = ''; });
    const card = dlg.querySelector('.modal-card');
    for (const t of ['dragenter', 'dragover']) card.addEventListener(t, (e) => { e.preventDefault(); card.classList.add('over'); });
    for (const t of ['dragleave', 'drop']) card.addEventListener(t, (e) => { if (t === 'drop' || !card.contains(e.relatedTarget)) card.classList.remove('over'); });
    card.addEventListener('drop', (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); });

    const close = () => {
      // images that never made it into a saved group don't need their preview URLs any more
      const kept = new Set(groups.flatMap((g) => g.images));
      for (const img of [...draft.images, ...removed]) if (!kept.has(img)) release(img);
      dlg.close();
      dlg.remove();
    };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dlg.addEventListener('click', async (e) => {
      if (e.target === dlg) { close(); return; }                // backdrop
      const x = e.target.closest('.pick-x');
      if (x) { removed.push(...draft.images.splice(+x.dataset.i, 1)); paint(); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'add') more.click();
      else if (act === 'close' || act === 'cancel') close();
      else if (act === 'delete-group') { if (await askDelete(group)) close(); }
      else if (act === 'confirm') {
        if (!draft.images.length) return;
        const saved = { id: group?.id || uid(), name: title.value.trim() || draft.name, created: group?.created || Date.now(), images: draft.images };
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Saving…';
        try {
          await saveGroup(saved, group);
        } catch (err) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Confirm';
          toast(`Couldn't save the group: ${err.message || err}`, 'error');
          return;
        }
        groups = group ? groups.map((g) => (g.id === saved.id ? saved : g)) : [...groups, saved];
        render();
        close();
        toast(group ? `Saved ${saved.name}` : `Created ${saved.name} · ${saved.images.length} image${saved.images.length === 1 ? '' : 's'}`, 'success');
      }
    });
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    dlg.showModal();
    confirmBtn.focus();
  }

  const nextName = () => {
    let n = groups.length + 1;
    while (groups.some((g) => g.name === `Group ${n}`)) n++;
    return `Group ${n}`;
  };

  listGroups().then((g) => { groups = g; render(); }).catch((err) => toast(`Couldn't load your photo groups: ${err.message || err}`, 'error'));
  return el;
}

/** a small confirm popup; resolves true / false */
function confirmBox(title, text, ok) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal modal-sm';
    dlg.innerHTML = `
      <div class="modal-card">
        <div class="modal-body"><h4>${esc(title)}</h4><p>${esc(text)}</p></div>
        <footer class="modal-foot"><span class="grow"></span>
          <button type="button" class="btn btn-ghost" data-v="0">Cancel</button>
          <button type="button" class="btn btn-danger solid" data-v="1">${esc(ok)}</button>
        </footer>
      </div>`;
    document.body.append(dlg);
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) return done(false);
      const b = e.target.closest('[data-v]');
      if (b) done(b.dataset.v === '1');
    });
    dlg.showModal();
    dlg.querySelector('[data-v="0"]').focus();
  });
}

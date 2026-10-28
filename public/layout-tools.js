// The edit step's layout tools: the Layout strip, the padded colour
// swatches, and the live preview of the layout. The preview is CSS only
// (app.css): the geometry from layouts.js becomes custom properties on
// #clip, which move the screen video's picture (object-view-box) and the
// camera video's box, so the two existing videos show the layout as it will
// render. The bubble's place, size and shape stay with bubble.js; the
// shape's squares are part of its view (editor.js attaches them).
import { LAYOUTS, layoutOf, layoutValue, geometry, previewVars, DEFAULT_COLOUR } from './layouts.js';

/**
 * @param {object} el  the page's elements: clip, preview, editBubble, bubbleTools, colourSet, fullView,
 *                     layouts (the strip's radios) and colours (the swatches' radios)
 */
export function attachLayoutTools(el) {
  let id = 'screen', colour = DEFAULT_COLOUR, screen = null, camera = null, offered = [];
  const listeners = [];

  // Shows the chosen layout: the strip, the tools that belong to it, and the preview.
  function show() {
    const composed = id !== 'screen';
    const g = geometry(id, screen.width, screen.height, camera?.width, camera?.height, colour);
    el.clip.dataset.layout = id;
    el.clip.dataset.composed = composed ? 'on' : 'off';
    for (const [k, v] of Object.entries(previewVars(g, screen.width, screen.height))) el.clip.style.setProperty(k, v);
    el.editBubble.hidden = !(camera && g.camera);
    el.bubbleTools.hidden = !(camera && id === 'bubble');
    el.colourSet.hidden = id !== 'padded';
    // The video's own full screen and picture in picture show the screen alone, so a composed layout uses Full screen.
    el.preview.disablePictureInPicture = composed;
    el.preview.setAttribute('controlslist', composed ? 'nofullscreen nodownload' : 'nodownload');
    el.fullView.hidden = !composed || !document.fullscreenEnabled;
    for (const r of el.layouts) { r.checked = r.value === id; r.disabled = !offered.includes(r.value); }
    for (const r of el.colours) r.checked = r.value === colour;
  }

  function choose(nextId, nextColour = colour, notify = true) {
    if (!screen || !offered.includes(nextId)) return;
    const changed = nextId !== id || nextColour !== colour;
    id = nextId;
    colour = nextColour;
    show();
    if (changed && notify) listeners.forEach((fn) => fn());
  }

  for (const r of el.layouts) r.addEventListener('change', () => { if (r.checked) choose(r.value); });
  for (const r of el.colours) r.addEventListener('change', () => { if (r.checked) choose(id, r.value); });

  return {
    /**
     * A recording opened. screen and camera are {width, height} (camera null without one). With the
     * webcam off only Screen only and Padded are offered; the default is Bubble with a camera and
     * Screen only without, unless `stored` ({id, colour}, from an uploaded recording) says otherwise.
     */
    open(screenSize, cameraSize, stored = null) {
      screen = screenSize;
      camera = cameraSize;
      offered = LAYOUTS.filter((l) => camera || !l.needsCamera).map((l) => l.id);
      colour = stored?.colour || DEFAULT_COLOUR;
      id = stored && offered.includes(stored.id) ? stored.id : (camera ? 'bubble' : 'screen');
      show();
    },
    get() { return { id, colour, value: layoutValue(id, colour), label: layoutOf(id).label }; },
    set: (nextId, nextColour) => choose(nextId, nextColour || colour),
    get offered() { return [...offered]; },
    geometry: () => (screen ? geometry(id, screen.width, screen.height, camera?.width, camera?.height, colour) : null),
    // Runs fn() after the layout or the colour changes (the edit step refreshes its thumbnail).
    onChange(fn) { listeners.push(fn); },
  };
}

// cast_helpers.js

// Initialize the Google Cast Sender SDK and helper functions for volume control
let baselineVolume = 1.0;
const REDUCED_VOLUME_FACTOR = 0.7;
let isBasketballMode = false;

// Expose getter for current baseline volume
function getBaselineVolume() {
  return baselineVolume;
}

// Expose the reduced volume factor
function getReducedVolumeFactor() {
  return REDUCED_VOLUME_FACTOR;
}

// Allow launcher.js to update the Basketball mode state
function setBasketballMode(on) {
  isBasketballMode = on;
}

// Called by the Cast SDK when available
window.__onGCastApiAvailable = function(loaded) {
  console.log('Cast SDK available:', loaded);
  if (!loaded) {
    console.error('Cast SDK failed to load');
    return;
  }
  const ctx = cast.framework.CastContext.getInstance();
  console.log('Initial isCasting:', isCasting());
  ctx.setOptions({
    receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
  });
  // capture the user's current volume when session starts
  ctx.addEventListener(
    cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
    event => {
      console.log('Session state changed:', event.sessionState, 'isCasting:', isCasting());
      if (event.sessionState === cast.framework.SessionState.SESSION_STARTED) {
        const session = ctx.getCurrentSession();
        if (session.getVolume) baselineVolume = session.getVolume();
        console.log('Baseline cast volume recorded:', baselineVolume);
        // listen for remote volume changes only in Basketball mode
        session.addEventListener(
          cast.framework.CastSessionEventType.VOLUME_CHANGED,
          () => {
            if (isBasketballMode && session.getVolume) {
              baselineVolume = session.getVolume();
              console.log('Basketball mode: updated baselineVolume to', baselineVolume);
            }
          }
        );
      }
      else if (event.sessionState === cast.framework.SessionState.SESSION_ENDED) {
        console.log('Cast session ended');
      }
    }
  );
};

// Helpers consumed by launcher.js
function isCasting() {
  const session = cast.framework.CastContext.getInstance().getCurrentSession();
  return !!session;
}

function maybeClose(delay) {
  if (delay) {
    setTimeout(() => {
      if (!isCasting()) window.close();
    }, delay);
  } else {
    if (!isCasting()) window.close();
  }
}

function setCastVolume(vol) {
  const session = cast.framework.CastContext.getInstance().getCurrentSession();
  if (!session) {
    console.warn('No Cast session active');
    return;
  }
  session.setVolume(vol)
    .then(() => console.log(`Cast volume set to ${vol}`))
    .catch(err => console.error('Failed to set cast volume:', err));
}

// Attach helpers to window
window.castHelpers = {
  isCasting,
  maybeClose,
  setCastVolume,
  getBaselineVolume,
  getReducedVolumeFactor,
  setBasketballMode
}; 
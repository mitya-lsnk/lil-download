import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A dropdown that closes shortly after the field loses focus.
 *
 * The delay is the whole point: a click on a suggestion first blurs the input,
 * and closing immediately would unmount the button before its own handler ran.
 *
 * Cleaning the timer up on unmount is the part that was missing everywhere this
 * pattern was written by hand — a component torn down mid-delay left a callback
 * scheduled against state that no longer existed.
 */
export function useCloseOnBlur(delay = 140) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const show = useCallback(() => {
    clear();
    setOpen(true);
  }, [clear]);

  const hideSoon = useCallback(() => {
    clear();
    timer.current = window.setTimeout(() => {
      setOpen(false);
      timer.current = null;
    }, delay);
  }, [clear, delay]);

  const hideNow = useCallback(() => {
    clear();
    setOpen(false);
  }, [clear]);

  return { open, show, hideSoon, hideNow };
}

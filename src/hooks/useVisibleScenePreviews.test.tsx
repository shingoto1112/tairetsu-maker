// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../sampleProject";
import { useVisibleScenePreviews } from "./useVisibleScenePreviews";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("preview viewport", () => {
  it("updates on intersection and ignores a disconnected observer", () => {
    const observers: { callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> }[]=[];
    vi.stubGlobal("IntersectionObserver", class {
      disconnect=vi.fn(); observe=vi.fn();
      constructor(callback: IntersectionObserverCallback) { observers.push({callback,disconnect:this.disconnect}); }
    });
    const frames=createSampleProject().frames;
    function Harness({collapsed=false}:{collapsed?:boolean}) {
      const ref=useRef<HTMLDivElement>(null), visible=useVisibleScenePreviews(ref,frames,collapsed);
      return <div ref={ref}>{frames.map(f=><button key={f.id} data-thumbnail-frame-id={f.id}>{String(visible.has(f.id))}</button>)}</div>;
    }
    const view=render(<Harness />), card=view.container.querySelector("button")!;
    const entry={target:card,isIntersecting:false} as unknown as IntersectionObserverEntry;
    act(()=>observers[0].callback([entry],{} as IntersectionObserver));
    expect(card.textContent).toBe("false");
    act(()=>observers[0].callback([{...entry,isIntersecting:true}],{} as IntersectionObserver));
    expect(card.textContent).toBe("true");
    view.rerender(<Harness collapsed />);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    act(()=>observers[0].callback([{...entry,isIntersecting:true}],{} as IntersectionObserver));
    expect(card.textContent).toBe("false");
  });
  it("renders every preview if IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver",undefined);
    const frames=createSampleProject().frames;
    function Harness() {
      const ref=useRef<HTMLDivElement>(null), visible=useVisibleScenePreviews(ref,frames,false);
      return <div ref={ref}>{visible.size}</div>;
    }
    expect(render(<Harness />).container.textContent).toBe(String(frames.length));
  });
});

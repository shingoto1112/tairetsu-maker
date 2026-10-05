// @vitest-environment jsdom
import { useState } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { HorizontalCountingCards } from "./HorizontalCountingCards";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("uses a named fieldset and native radios with card labels and hidden SVG", async()=>{
  const Demo=()=>{const [value,setValue]=useState<'meters'|'centerSplit'>('centerSplit');return <HorizontalCountingCards value={value} onChange={setValue}/>;};
  // jsdom lacks CSS.escape; this test uses React's alphanumeric radio names.
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, char => '\\' + char) });
  const {container}=render(<Demo/>);const user=userEvent.setup();
  expect(screen.getByRole('group',{name:'横の数え方'})).toBeTruthy();
  const radios=screen.getAllByRole('radio') as HTMLInputElement[];
  expect(radios[1].checked).toBe(true);expect(radios[0].name).toBe(radios[1].name);
  await user.tab();expect(document.activeElement).toBe(radios[1]);
  await user.keyboard('[ArrowLeft]');expect(radios[0].checked).toBe(true);
  await user.click(radios[1].closest('label')!);expect(radios[1].checked).toBe(true);
  expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
});
it("disabled compact cards retain native disabled semantics and group names are isolated",()=>{
  const {container}=render(<><HorizontalCountingCards compact disabled value="meters" onChange={()=>{}}/><HorizontalCountingCards value="centerSplit" onChange={()=>{}}/></>);
  const groups=screen.getAllByRole('group');expect((groups[0] as HTMLFieldSetElement).disabled).toBe(true);
  const radios=screen.getAllByRole('radio') as HTMLInputElement[];expect(radios[0].name).not.toBe(radios[2].name);
  expect(container.querySelector('.horizontal-counting--compact')).toBeTruthy();
});

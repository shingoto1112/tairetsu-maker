/** Shared by measuring and drawing: the complete count is one inline box. */
export const setMemberHeadingText = (element: HTMLElement, text: string) => {
  const suffix = text.match(/（\d+人）$/)?.[0];
  element.replaceChildren(document.createTextNode(suffix ? text.slice(0, -suffix.length) : text));
  if (suffix) {
    const count = document.createElement("span");
    count.style.whiteSpace = "nowrap";
    count.textContent = suffix;
    element.append(count);
  }
};

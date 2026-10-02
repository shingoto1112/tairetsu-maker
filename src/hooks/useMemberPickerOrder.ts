import { useEffect, useState } from "react";
import type { MemberPickerOrder } from "../utils/memberOrdering";

export const MEMBER_PICKER_ORDER_KEY = "tairetsu-maker:member-picker-order";
const orderChanged = "member-picker-order-changed";
const readOrder = (): MemberPickerOrder => {
  try {
    return localStorage.getItem(MEMBER_PICKER_ORDER_KEY) === "name" ? "name" : "group";
  } catch { return "group"; }
};

export const useMemberPickerOrder = () => {
  const [order, setOrder] = useState<MemberPickerOrder>(readOrder);
  useEffect(() => {
    const refresh = () => setOrder(readOrder());
    window.addEventListener("storage", refresh);
    window.addEventListener(orderChanged, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(orderChanged, refresh);
    };
  }, []);
  const selectOrder = (value: MemberPickerOrder) => {
    setOrder(value);
    try {
      localStorage.setItem(MEMBER_PICKER_ORDER_KEY, value);
      window.dispatchEvent(new Event(orderChanged));
    } catch { /* The list remains usable when storage is unavailable. */ }
  };
  return [order, selectOrder] as const;
};

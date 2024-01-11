import { LocalDate } from '@js-joda/core';

export const secondsToMs = (seconds) => seconds * 1000;
export const minutesToSeconds = (minutes) => minutes * 60;
export const minutesToMs = (minutes) => secondsToMs(minutesToSeconds(minutes));
export const currentDateStr = () => LocalDate.now().toString();

// Caps on the free-form parts of a result, so one request can't fan out into a huge number of
// rows or megabytes of text (FR-074). Long logs belong in attachments.
export const RESULT_COMMENT_MAX_LENGTH = 10_000;
export const STEP_RESULTS_MAX_ITEMS = 200;
export const STEP_RESULT_COMMENT_MAX_LENGTH = 2_000;

/** Host route for complete provider-neutral Session archive transfers. */

/** Absolute route registered with Connection. */
export const SESSION_ARCHIVE_PATH = '/api/session.archive'

/** Authenticated route that lists regular `.sqlite` files in a selected directory. */
export const SESSION_ARCHIVE_SQLITE_LIST_PATH = `${SESSION_ARCHIVE_PATH}/sqlite-backups`

/** Authenticated route that converts and imports one selected Desktop SQLite backup. */
export const SESSION_ARCHIVE_SQLITE_IMPORT_PATH = `${SESSION_ARCHIVE_PATH}/sqlite-import`

/** Document-relative route used by the browser. */
export const SESSION_ARCHIVE_ROUTE = SESSION_ARCHIVE_PATH.slice(1)

/** Document-relative SQLite backup directory route used by the browser. */
export const SESSION_ARCHIVE_SQLITE_LIST_ROUTE = SESSION_ARCHIVE_SQLITE_LIST_PATH.slice(1)

/** Document-relative SQLite conversion and import route used by the browser. */
export const SESSION_ARCHIVE_SQLITE_IMPORT_ROUTE = SESSION_ARCHIVE_SQLITE_IMPORT_PATH.slice(1)

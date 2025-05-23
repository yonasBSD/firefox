/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { LocalizationHelper } = require("resource://devtools/shared/l10n.js");
const helper = new LocalizationHelper(
  "devtools/client/locales/webconsole.properties"
);

let dateFormatter;

const l10n = {
  /**
   * Generates a formatted timestamp string for displaying in console messages.
   *
   * @param integer [milliseconds]
   *        Optional, allows you to specify the timestamp in milliseconds since
   *        the UNIX epoch. If not provided, the current timestamp will be used.
   * @return string
   *         The timestamp formatted for display.
   */
  timestampString(milliseconds) {
    const d = new Date(milliseconds ? milliseconds : null);
    const hours = d.getHours();
    const minutes = d.getMinutes();
    const seconds = d.getSeconds();
    milliseconds = d.getMilliseconds();
    const parameters = [hours, minutes, seconds, milliseconds];
    return l10n.getFormatStr("timestampFormat", parameters);
  },

  /**
   * Generates a formatted date string for displaying in console messages.
   *
   * @param integer [milliseconds]
   *        Optional, allows you to specify the timestamp in milliseconds since
   *        the UNIX epoch from which the date will be derived. If not provided,
   *        the current timestamp will be used.
   * @returns string
   *          The date formatted for display.
   */
  dateString(milliseconds) {
    if (!dateFormatter) {
      dateFormatter = new Intl.DateTimeFormat();
    }
    return dateFormatter.format(milliseconds || Date.now());
  },

  /**
   * Retrieve a localized string.
   *
   * @param string name
   *        The string name you want from the Web Console string bundle.
   * @return string
   *         The localized string.
   */
  getStr(name) {
    try {
      return helper.getStr(name);
    } catch (ex) {
      console.error("Failed to get string: " + name);
      throw ex;
    }
  },

  /**
   * Retrieve a localized string formatted with values coming from the given
   * array.
   *
   * @param string name
   *        The string name you want from the Web Console string bundle.
   * @param array array
   *        The array of values you want in the formatted string.
   * @return string
   *         The formatted local string.
   */
  getFormatStr(name, array) {
    try {
      return helper.getFormatStr(name, ...array);
    } catch (ex) {
      console.error("Failed to format string: " + name);
      throw ex;
    }
  },
};

module.exports = l10n;

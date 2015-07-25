/*
 * FieldDBGlosser
 * https://github.com/OpenSourceFieldlinguistics/FieldDB/issues/milestones?state=closed
 *
 * Copyright (c) 2013 FieldDB contributors
 * Licensed under the Apache 2.0 license.
 */
(function(exports) {

  'use strict';

  var locald3;
  try {
    locald3 = exports.d3 ? exports.d3 : require('d3');
    global.d3 = global.d3 || locald3;
  } catch (exception1) {
    console.log('There was a problem setting d3', locald3);
  }

  var Glosser = exports.Glosser || require("fielddb/api/glosser/Glosser").Glosser;
  Glosser.d3 = locald3;

  exports.Glosser = Glosser;
  global.Glosser = Glosser;

}(typeof exports === 'object' && exports || this));

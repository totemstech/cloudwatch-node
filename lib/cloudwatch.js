// Copyright Teleportd Ltd. and other Contributors
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
var fwk = require('fwk');
var AWS = require('aws-sdk');
var config = fwk.populateConfig(require('../config.js').config);

//
// ## Cloudwatch Pre Aggregation module for NodeJS
// This module allows to easily track metrics with Amazon Cloudwatch based
// on a single code line. These metrics are aggregated and sent on a regular
// basis using AWS API.
// ```
// @spec { accessKeyId, secretAccessKey, sessionToken, region }
// ```
//
var cloudwatch = function(spec, my) {
  var _super = {};
  my = my || {};

  /* Credentials   */
  my.accessKeyId = config['AWS_ACCESS_KEY_ID'] === 'dummy-env' ?
    spec.accessKeyId : config['AWS_ACCESS_KEY_ID'];

  my.secretAccessKey = config['AWS_SECRET_ACCESS_KEY'] === 'dummy-env' ?
    spec.secretAccessKey : config['AWS_SECRET_ACCESS_KEY'];

  my.sessionsToken = config['AWS_SESSION_TOKEN'] === 'dummy-env' ?
    spec.sessionToken : config['AWS_SESSION_TOKEN'];

  my.region = config['AWS_REGION'] === 'dummy-env' ?
    spec.region : config['AWS_REGION'];

  /* Configuration */
  my.commit_interval =
    spec.commit_interval || config['AWS_CLOUDWATCH_COMMIT_ITV'];
  my.DEBUG = spec.debug || config['AWS_CLOUDWATCH_DEBUG'];

  my.acc = {};

  //
  // #### _public methods_
  //
  var agg;
  var start;
  var stop;

  //
  // #### _private methods_
  //
  var serialize;
  var format_date;
  var build_stats;
  var commit;

  //
  // #### _that_
  //
  var that = {};

  /****************************************************************************/
  /*                              PRIVATE HELPERS                             */
  /****************************************************************************/
  //
  // ### serialize
  // Serialize an object so that it always give the same string
  // ```
  // @value {object} the object to serialize
  //    can be string | number | array | object
  // @return {string} the serialized object
  // ```
  //
  serialize = function(value) {
    if(Array.isArray(value)) {
      var s = '[';
      for(var i = 0; i < value.length; i ++) {
        s += ((i !== 0) ? ',' : '') + serialize(value[i]);
      }
      s += ']';
      return s;
    }
    if(typeof value === 'object') {
      var array = [];
      for(var o in value) {
        if(value.hasOwnProperty(o)) {
          array.push(o + ':' + serialize(value[o]));
        }
      }
      array.sort(function(a, b) {
        return a.split(':')[0] > b.split(':')[0];
      });
      var s = '{'
      for(var i = 0; i < array.length; i ++) {
        s += ((i !== 0) ? ',' : '') + array[i];
      }
      s += '}';
      return s;
    }
    return(JSON.stringify(value));
  };

  //
  // ### format_date
  // Return the given date as a string formated for AWS
  // ```
  // @date   {date} the date to format
  // @return {string} the date formated for AWS
  // ```
  //
  format_date = function(date) {
    /* We only keep details at a minute level */
    date.setUTCSeconds(0);
    date.setUTCMilliseconds(0);
    return date.toISOString();
  };

  //
  // ### extract_points
  // Extracts the points from the accumulator, and clean the accumulator
  // ```
  // @return {array} an array of points ready to be submitted.
  // ```
  //
  extract_points = function() {
    var points = [];

    for(var namespace in my.acc) {
      if(my.acc.hasOwnProperty(namespace)) {
        var point = {
          Namespace: namespace,
          MetricData: []
        };

        for(var id in my.acc[namespace]) {
          if(my.acc[namespace].hasOwnProperty(id)) {
            var metric = {
              MetricName: '',
              Dimensions: [],
              Timestamp:  '',
              Unit:       'None',
              StatisticValues: {
                Maximum: Number.MIN_VALUE,
                Minimum: Number.MAX_VALUE,
                Sum: 0,
                SampleCount: 0
              }
            };

            my.acc[namespace][id].forEach(function(pt) {
              metric.MetricName = pt.name;
              metric.Dimensions = pt.dimensions;
              metric.Timestamp  = pt.date;
              metric.Unit       = pt.unit;

              metric.StatisticValues.Maximum = Math.max(
                pt.value,
                metric.StatisticValues.Maximum
              );
              metric.StatisticValues.Minimum = Math.min(
                pt.value,
                metric.StatisticValues.Minimum
              );
              metric.StatisticValues.Sum += pt.value;
              metric.StatisticValues.SampleCount ++;
            });

            delete my.acc[namespace][id];
            point.MetricData.push(metric);
          }
        };

        points.push(point);
        delete my.acc[namespace];
      }
    }

    return points;
  };

  //
  // ### commit
  //
  commit = function() {
    var points = extract_points();

    fwk.async.each(points, function(point, cb_) {
      my.cloudwatch.putMetricData(point, cb_)
    }, function(err) {
      if(my.DEBUG) {
        if(err) {
          console.log(err.stack);
        }
        else {
          console.log('Cloudwatch aggs successfully sent.');
        }
      }
    });
  };

  /****************************************************************************/
  /*                             PUBLIC INTERFACE                             */
  /****************************************************************************/
  //
  // ### agg
  // Aggregate the given value to the specified statistic.
  // ```
  // @namespace  {string} The namespace for the metric data
  // @name       {string} The name of the metric
  // @value      {number} The value for the metric
  // @unit       {string} [opt] The unique of the metric
  // @dimensions {array}  [opt] A list of dimensions associated to the metric
  // ```
  //
  agg = function(namespace, name, value, unit, dimensions) {
    if(!(typeof namespace === 'string' && namespace.trim() !== '')) {
      throw new Error('Bad `namespace`: ' + namespace);
    }
    if(!(typeof name === 'string' && name.trim() !== '')) {
      throw new Error('Bad `name`: ' + name);
    }
    if(!(typeof value === 'number')) {
      throw new Error('Bad `value`: ' + value);
    }
    if(!my.started) {
      return;
    }

    unit       = unit || 'None';
    dimensions = dimensions || [];
    if(!Array.isArray(dimensions)) {
      throw new Error('Bad `dimensions`: ' + JSON.stringify(dimensions));
    }
    for(var i = 0; i < dimensions.length; i++) {
      if(!(typeof dimensions[i] === 'object' &&
           typeof dimensions[i].Name === 'string' &&
           typeof dimensions[i].Value === 'string')) {
        throw new Error('Bad `dimension`: ' + JSON.stringify(dimensions[i]));
      }
    };

    var date = format_date(new Date());
    var agg_on = name + ';' +
      unit + ';' +
      serialize(dimensions) + ';' +
      date;

    my.acc[namespace] = my.acc[namespace] || {};

    my.acc[namespace][agg_on] = my.acc[namespace][agg_on] || [];
    my.acc[namespace][agg_on].push({
      date:       date,
      name:       name,
      value:      value,
      unit:       unit,
      dimensions: dimensions
    });
  };

  //
  // ### start
  // Starts the commit interval
  //
  start = function() {
    if(!my.started) {
      my.started = true;

      if(!my.cloudwatch) {
        my.cloudwatch = new AWS.CloudWatch({
          "accessKeyId":     my.accessKeyId,
          "secretAccessKey": my.secretAccessKey,
          "region":          my.region
        });
      }

      my.itv = setInterval(commit, my.commit_interval);
    };
  };

  //
  // ### stop
  // Cancels the commit interval. Aggregates are ignored once the process has
  // been stopped.
  //
  stop = function() {
    if(my.started) {
      my.started = false;

      clearInterval(my.itv);
      delete my.itv;
    }
  };

  /* Implicit launch */
  start();

  fwk.method(that, 'agg', agg, _super);
  fwk.method(that, 'start', start, _super);
  fwk.method(that, 'stop', stop, _super);

  return that;
};

exports.cloudwatch = cloudwatch;

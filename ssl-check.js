#!/usr/bin/env node
'use strict';
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
var Datastore = require('nedb'),
  prog = require('commander'),
  db = new Datastore({filename:'./var/db',autoload:true}),
  req = require('request'),
  q = require('q'),
  api = 'https://api.uptimerobot.com',
  https = require('https'),
  moment = require('moment'),
  slackConfig = require('./var/slack'),
  Slack = require('slack-node'),
  slack = new Slack(),
  _ = require('lodash');
var data = {
  apiKey: require('./var/uptimeRobot'),
  format: 'json',
  noJsonCallback:1
};

slack.setWebhook(slackConfig.hook);
function hook(opts) {
  var payload = {
    "fallback": opts.fallback || opts.msg,
    "color": opts.color,
    "fields": [
      {
        "title": opts.title,
        "value": opts.msg || opts.fallback,
        "short": false
      }, 
    ]
  }
  slack.webhook({
    channel: slackConfig.channel || '#general',
    username: 'SSL Check',
    attachments: [ payload ]
  }, function(err,response) {
  });
}
prog
.version('1.0.0');

prog
.command('update')
.description('check every site and update local db with cert expiry')
.action(function() {
  db.find({}, function(err, monitors) {
    monitors.forEach(function(monitor) {
      if(monitor.url.indexOf('http://') === 0) {
        https.get('https' + monitor.url.substring(4), function(res) {
          var cert = res.socket.getPeerCertificate();
          var valid_to = new Date(cert.valid_to);
          if(!monitor.valid_to || valid_to.getTime() !== monitor.valid_to.getTime()) {
            console.log('updating expiration',monitor.friendlyname,cert.valid_to);
            db.update({_id:monitor.id}, { $set: {valid_to: new Date(cert.valid_to)}});
          }
        });
      }
    });
  });
});
prog
.command('insert')
.description('get the list of checks from UptimeRobot and insert any missing ones into local db')
.action(function () {
  // grab 50 monitors starting with offset and add to db if not present
  function fetch(offset) {
    var deferred = q.defer();
    data.offset = offset;
    req({ url: api + '/getMonitors', qs: data}, function(err, res, body) {
      if(err) {
        console.error(err);
        deferred.reject();
      }
      if(res.statusCode === 200) {
        var json = JSON.parse(body);
        json.monitors.monitor.forEach(function(monitor) {
          db.findOne({_id:monitor.id}, function(err, rec) {
            if(!rec) {
              monitor._id=monitor.id;
              console.log('adding',monitor.friendlyname,monitor.url);
              db.insert(monitor);
            }
          });
        });
        deferred.resolve(json.monitors.monitor.length);
      } else {
        deferred.reject();
        console.error(res);
      }
    });
    return deferred.promise;
  }
  // process the next 50 monitors after offset. if there are more to go, check the next batch
  function checkNext(offset) {
    fetch(offset).then(function(fetched) {
      console.log('fetched ' + offset + '-' + (offset+50));
      if(fetched === 50) {
        checkNext(offset+50);
      }
    });
  }
  // begin at the beginning
  checkNext(0);
});
prog
.command('recheck')
.description('recheck each expired or expiring cert and notify slack on renewal')
.action(function() {
  var today = moment();
  db.find({ valid_to: { $lt: moment().add(7, 'days').toDate()}}, function(err, monitors) {
    monitors.forEach(function(monitor) {
      https.get('https' + monitor.url.substring(4), function(res) {
        var cert = res.socket.getPeerCertificate();
        var valid_to = new Date(cert.valid_to);
        if(!monitor.valid_to || valid_to.getTime() !== monitor.valid_to.getTime()) {
          console.log('updating expiration',monitor.friendlyname,cert.valid_to);
          db.update({_id:monitor.id}, { $set: {valid_to: new Date(cert.valid_to)}});
        }
        if(moment(valid_to).subtract(8,'days').isAfter(today)) {
          hook({
            msg: '<https' + monitor.url.substring(4) + '|' + monitor.friendlyname + '> until ' + moment(valid_to).format('D-MMM-YYYY'),
            title: 'Renewal',
            color: 'good'
          });
        } else {
          console.log(monitor.friendlyname + ' has not been renewed');
        }
      });
    });
  });
});
prog
.command('notify')
.description('notify slack channel about any expring or expired certs')
.action(function() {
  var today = moment();
  db.find( { valid_to: { $lt : moment().add(7,'days').toDate()}}, function(err,monitors) {
    var split = _(monitors)
    .sortBy('valid_to')
    .partition(function(monitor) { return moment(monitor.valid_to).isAfter(today); })
    .value();
    function msgify(monitors) { return _.reduce(_.sortBy(monitors,'valid_to') , function(msg, monitor) {
      return msg + '\n' + '<https'+ monitor.url.substring(4) + '|' + monitor.friendlyname + '> ' + moment(monitor.valid_to).fromNow();
    },'') };
    var msg='',color, expired, expiring;

    if(monitors.length) {
      msg = 'Expired: ' 

      expired = split[1].length ? msgify(split[1]) : 'none';
      msg += expired;

      msg += '\nExpiring Soon: '
      expiring = split[0].length ? msgify(split[0]) : 'none';
      msg += expiring;
      color = split[1].length ? 'danger' : 'warning';
    } else {
      msg = 'All certificates OK';
      color='good';
    }

    if(monitors.length) {
      if(split[1].length) {
        var list = msgify(split[1]);
        hook({msg: list, fallback: 'Expired: ' + list, title: 'Expired', color: 'danger'});
      }
      if(split[0].length) {
        var list = msgify(split[0]);
        hook({msg: list, fallback: 'Expiring Soon: ' + list, title: 'Expiring Soon', color: 'warning'});
      }
    } else {
      hook({ msg: 'All certificates OK', title: 'OK', color: 'good'});
    }
  });
});
prog.parse(process.argv);
if (!process.argv.slice(2).length) {
  prog.outputHelp();
}

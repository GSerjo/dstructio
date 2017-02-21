#!/usr/bin/env nodejs

var express = require('express');
var favicon = require('serve-favicon');
var app     = express();
var http    = require('http').Server(app);
var io      = require('socket.io')(http);
var ioClient = require('socket.io-client');
var config  = require('./config.json');
var fs      = require('fs');
var timestamp = require('console-timestamp');


/*******************************************************************************
 *
 * MY VARS.
 *
 ******************************************************************************/

var GAME_DEBUG = false;

var listFile = './serverlist.json';
var serverList = [];

// The maximum number of users per server before the next server will be
// selected. Note that if all servers are full, the router will still assign
// servers at random, rather than reject users.
var maxUsersPerServer = 20;

var serverStats = [];
var cachedSockets = {};

/*******************************************************************************
 *
 * socket.io setup.
 *
 ******************************************************************************/

io.on('connection', function (socket) {
    socket.on('get server', getServer);
});

function getServer() {
    var address;

    if (serverStats.length > 0) {
        var sortedList = sortServersByUsers();
        var i;

        // Ensure each server has the maximum number of users before
        // populating the next one.
        for (i = 0; i < sortedList.length; i++) {
            if (sortedList[i].users < maxUsersPerServer) {
                address = sortedList[i].address;
                break;
            }
        }

        if (!address) {
            // Just get random server for now.
            i = Math.floor(Math.random() * sortedList.length);
            var server = sortedList[i];
            address = server.address;
        }
    }

    log(`Server selected: ${address}`);

    // Send address, or null if no address found.
    io.to(this.id).emit('server', { ip: address });
}

function updateServerList() {
    var data = fs.readFileSync(listFile, 'utf-8').toString();
    var i;

    serverList = JSON.parse(data);

    for (i = 0; i < serverStats.length; i++) {
        serverStats[i].enabled = false;
    }

    for (i = 0; i < serverList.length; i++) {
        var addr = serverList[i].address;
        var obj = findServerObjByAddress(addr);

        if (obj) {
            obj.enabled = true;
        }
        else {
            obj = { address: addr,
                    enabled: true,
                    users:   0
                  };

            serverStats.push(obj);
        }

        // Query the number of users on this server.
        var sock = obj.sock;

        if (!sock || !sock.connected) {
            sock = ioClient.connect('ws://' + addr);
            obj.sock = sock;

            sock.on('disconnect', disconnectSock);
            sock.on('server data', serverData);
        }

        sock.emit('get data', { address: addr });
    }

    // Remove inactive servers.
    serverStats = serverStats.filter(function(f) {
        return f.enabled;
    });
}

function disconnectSock() {
    var sockid = this.id;
    for (var i = 0; i < serverStats.length; i++) {
        if (serverStats[i].sockid === sockid) {
            serverStats[i].sock = null;
            serverStats[i].sockid = null;
        }
    }
}

function serverData(data) {
    var obj = findServerObjByAddress(data.address);
    if (obj) {
        obj.sockid = this.id;

        // NOTE: users data is a rolling average of the number of users
        //       updated in 5 minute intervals.
        obj.users = data.users;
        log(`Server ${obj.address} has ${obj.users} users`);
    }
}


function findServerObjByAddress(addr) {
    for (var i = 0; i < serverStats.length; i++) {
        if (serverStats[i].address === addr) {
            return serverStats[i];
        }
    }
}

function sortServersByUsers() {
    var sortedList = serverStats.concat().sort(function f(a, b) {
        return b.users - a.users;
    });

    return sortedList;
}

function log(m) {
    console.log('YYYY-MM-DD hh:mm:ss'.timestamp + " :: " + m);
}

/*******************************************************************************
 *
 * RUN THE SERVER LOOP.
 *
 ******************************************************************************/

setInterval(updateServerList, 30000); // update server list from file

// STARTUP.
updateServerList();

/*******************************************************************************
 *
 * START SERVER.
 *
 ******************************************************************************/

app.use(favicon(__dirname + '/../client/favicon.ico'));
app.use('/', express.static(__dirname + '/../client/'));

var serverPort = config.port || 3000;
http.listen(serverPort, function() {
  console.log(`Server port: ${serverPort}`);
});

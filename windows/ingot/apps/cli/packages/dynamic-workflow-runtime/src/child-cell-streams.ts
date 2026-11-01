
export const CELL_STREAMS_BOOTSTRAP = String.raw`
"use strict";

var __channels = [];
var __parkedReceivers = 0;
var __CHANNEL_COMPACT_MIN = 1024;
var __END = Object.freeze({ value: undefined, done: true });

function __channel(name) {
  var label = name === undefined || name === null ? "channel #" + (__channels.length + 1) : String(name);
  var state = { label: label, items: [], head: 0, waiters: [], waitHead: 0, closed: false };
  __channels.push(state);

  function compact() {
    if (state.head >= __CHANNEL_COMPACT_MIN && state.head * 2 >= state.items.length) {
      state.items = state.items.slice(state.head);
      state.head = 0;
    }
    if (state.waitHead >= __CHANNEL_COMPACT_MIN && state.waitHead * 2 >= state.waiters.length) {
      state.waiters = state.waiters.slice(state.waitHead);
      state.waitHead = 0;
    }
  }
  function takeWaiter() {
    if (state.waitHead >= state.waiters.length) return undefined;
    var waiter = state.waiters[state.waitHead];
    state.waiters[state.waitHead] = undefined;
    state.waitHead += 1;
    __parkedReceivers -= 1;
    compact();
    return waiter;
  }
  function next() {
    if (state.head < state.items.length) {
      var item = state.items[state.head];
      state.items[state.head] = undefined;
      state.head += 1;
      compact();
      return Promise.resolve({ value: item, done: false });
    }
    if (state.closed) return Promise.resolve(__END);
    return new Promise(function (resolve) {
      state.waiters.push(resolve);
      __parkedReceivers += 1;
    });
  }
  var channel = {
    send: function (item) {
      if (state.closed) {
        var err = new Error("Channel \"" + state.label + "\" is closed: send() after close(). The stage that produces into a channel owns its close; close it in a finally once every producer has finished.");
        err.name = "ChannelClosed";
        err.code = "ChannelClosed";
        throw err;
      }
      var waiter = takeWaiter();
      if (waiter !== undefined) waiter({ value: item, done: false });
      else state.items.push(item);
    },
    close: function () {
      if (state.closed) return;
      state.closed = true;
      for (var waiter = takeWaiter(); waiter !== undefined; waiter = takeWaiter()) waiter(__END);
    },
  };
  channel[Symbol.asyncIterator] = function () {
    var iterator = {
      next: next,
      return: function () {
        return Promise.resolve(__END);
      },
    };
    iterator[Symbol.asyncIterator] = function () {
      return iterator;
    };
    return iterator;
  };
  return channel;
}

function __future(body) {
  try {
    var result = body();
    return result instanceof Promise ? result : Promise.resolve(result);
  } catch (e) {
    return Promise.reject(e);
  }
}

globalThis.__checkStalled = function () {
  if (__settled || __pending.size > 0) return false;
  var waiting = [];
  for (var i = 0; i < __channels.length; i++) {
    var ch = __channels[i];
    var count = ch.waiters.length - ch.waitHead;
    if (count > 0) waiting.push(count + " on \"" + ch.label + "\"");
  }
  var err;
  if (waiting.length > 0) {
    err = new Error(
      "Deadlock: " + __parkedReceivers + " receiver(s) waiting (" + waiting.join(", ") +
        ") with no request in flight, so nothing can ever send again. Close each channel from the stage that produces into it (ch.close() in a finally) once its producers are done."
    );
    err.name = "ChannelDeadlock";
    err.code = "ChannelDeadlock";
  } else {
    err = new Error(
      "Stalled: the script is suspended with no request in flight and no channel receiver waiting, so nothing can ever resolve what it awaits (a promise that is never settled)."
    );
    err.name = "ScriptStalled";
    err.code = "ScriptStalled";
  }
  __complete(false, err);
  return true;
};

globalThis.__host.channel = __channel;
globalThis.__host.future = __future;
`;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MatchStatus = void 0;
var MatchStatus;
(function (MatchStatus) {
    MatchStatus["SEARCHING"] = "SEARCHING";
    MatchStatus["MATCHED"] = "MATCHED";
    MatchStatus["AUTHORIZED"] = "AUTHORIZED";
    MatchStatus["LOCK_REQUESTED"] = "LOCK_REQUESTED";
    MatchStatus["LOCK_CONFIRMED"] = "LOCK_CONFIRMED";
    MatchStatus["RELEASED"] = "RELEASED";
    MatchStatus["EXPIRED"] = "EXPIRED";
    MatchStatus["FAILED"] = "FAILED";
})(MatchStatus || (exports.MatchStatus = MatchStatus = {}));

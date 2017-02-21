var gulp = require('gulp'),
    babel = require('gulp-babel'),
    browserify = require('browserify'),
    source = require('vinyl-source-stream'),
    buffer = require('vinyl-buffer'),
    rename = require('gulp-rename'),
    uglify = require('gulp-uglify'),
    del = require('del'),
    exec = require('child_process').exec,
    replace = require('gulp-replace');

gulp.task('build', ['build-common', 'build-client', 'build-server']);
gulp.task('deploy-extra', ['move-common', 'move-client', 'move-server']);
gulp.task('deploy', ['build', 'deploy-extra', 'deploy-common',
          'deploy-client', 'deploy-server', 'deploy-client-vis',
          'deploy-client-singleserver']);

/* CLEAN WORK DIR */
gulp.task('clean', ['clean-temp', 'clean-bin']);

gulp.task('clean-temp', function() {
    return del('build/**/*', {force: true});
});

gulp.task('clean-bin', function() {
    return del('bin/**/*', {force: true});
});

/* BUILD */

gulp.task('build-common', ['clean'], function () {
    return gulp.src(['src/common/*.js'])
        .pipe(babel())
        .pipe(gulp.dest('./build/common/'));
});

gulp.task('build-client', ['clean', 'build-common'], function () {
    return gulp.src(['src/client/js/*.js'])
        .pipe(babel())
        .pipe(gulp.dest('./build/client/js/'));
});

gulp.task('build-server', ['clean', 'build-common'], function () {
    return gulp.src(['src/server/**/*.js'])
        .pipe(babel())
        .pipe(gulp.dest('./build/server/'));
});

/* DEPLOY FROM BUILD DIR */

gulp.task('deploy-client', ['build'], function() {
    return browserify('build/client/js/client.js').bundle()
        .pipe(source('app.js'))
        .pipe(buffer())
        //.pipe(uglify())
        .pipe(rename('app.js'))
        .pipe(gulp.dest('./bin/client/js/'))
});

gulp.task('deploy-client-vis', ['build'], function() {
    return browserify('build/client/js/vis.js').bundle()
        .pipe(source('vis.js'))
        .pipe(buffer())
        //.pipe(uglify())
        .pipe(gulp.dest('./bin/client/js/'))
});

gulp.task('deploy-client-singleserver', ['build'], function() {
    return browserify('build/client/js/singleserver.js').bundle()
        .pipe(source('singleserver.js'))
        .pipe(buffer())
        //.pipe(uglify())
        .pipe(gulp.dest('./bin/client/js/'))
});

gulp.task('deploy-common', ['build'], function() {
    return gulp.src('build/common/**/*.js')
        .pipe(buffer())
        //.pipe(uglify())
        .pipe(gulp.dest('./bin/common/'))
});

gulp.task('deploy-server', ['build'], function() {
    return gulp.src('build/server/**/*.js')
        .pipe(buffer())
        //.pipe(uglify())
        .pipe(gulp.dest('./bin/server/'))
});

/* RELEASE NON-JS FILES*/

gulp.task('move-common', function () {
    return gulp.src(['src/common/*', '!src/common/*.js'])
        .pipe(gulp.dest('./bin/common/'));
});

gulp.task('move-client', function () {
    return gulp.src(['src/client/**/*.*', '!src/client/js/*.js'])
        .pipe(gulp.dest('./bin/client/'));
});

gulp.task('move-server', function() {
    return gulp.src(['src/server/**/*.*', '!src/server/**/*.js'])
        .pipe(gulp.dest('./bin/server/'));
});

/* START ROUTER & SERVER */

gulp.task('run', ['deploy'], function () {
    exec('node bin/server/router.js', function (err, stdout, stderr) {
        if (err) {
            console.error(err);
            return;
        }

        console.log(stdout);
        console.log(stderr);
    });

});

gulp.task('runserver', ['deploy'], function () {
    exec('node bin/server/server.js', function (err, stdout, stderr) {
        if (err) {
            console.error(err);
            return;
        }

        console.log(stdout);
        console.log(stderr);
    });
});

gulp.task('runall', ['run', 'runserver']);
gulp.task('default', ['runall']);

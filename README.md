# Obsidian Index Checker Plugin

Make sure your index (MOC) files contain all links they should contain!

Convenient and unopinionated Obsidian plugin which will check if all the necessary links are included in your index (MOC) files, while allowing you to maintain complete control over their structure and formatting.
___

## Updates

1.0.0 
- Added full support of Canvas index files! 
- Support of Ignore patterns for linked files.
- Support for multiple Index files per folder (ie both md and canvas files, etc).

0.9.4 
- Fixed bug that crashed plugin if non .MD files (images, canvas, etc) had the same name as index file
___

## How it works

- __Define which files in your Vault are Index(MOC) files.__  
_Both Notes(.md) and Canvas files are supported. Simply specify how those files are named. Example patterns could be "__index__", "__MOC__", "__\[FOLDER\]__", "\___\[FOLDER\]__" etc, where __\[FOLDER\]__ stands for containing folder('s) name._

- __Then specify which files in the folder should be linked in an index.__  
_Currently there're three options: a) all files in the same folder. b) all files in the folder _and_ all files in subfolders. c) all files in the folder _and_ files in subfolders but only if those subfolders don't have their own indexes._

- __Plugin checks if all index(MOC) files contain all links they should contain!__  
_Check-up could be triggered manually or performed every time a vault is opened._

- __Then it adds missing links either to Index file or to a dedicated file.__  
_So that later they can be moved to their proper places inside index. For .md files you can customize formatting of those links. For canvas indexes -  things like position, dimensions and grouping of cards._

- __Also files that had missing links are marked in file explorer.__  
_Those marks persist until file is modified (for index files) or cleared of any links (for dedicated "missing links" file)._

__Check out plugin settings page after you install it for details on all options.__
___

## Why?

Although there're a few community plugins for maintaining indexes, most of them enforce rigid structure (user defined in best cases) for all index files. What I was looking for is a more flexible solution that will simply check if all links are in place (and no files are "lost"), while allowing users to organize each of their index files in whatever way they prefer (and change it whenever they want!). Additionally, it should facilitate the addition of missing links to index files. Here's my solution to the problem, try it out :)
___

## Make it better

You're most welcome to add PR for a new feature, bug fix or simply better solution.

OR make a feature request on thread at Obsidian community forum that I will create as soon as plugin is approved. Yes, I'm willing to expand functionality based on popular requests asap :)
___



## Licence

MIT
